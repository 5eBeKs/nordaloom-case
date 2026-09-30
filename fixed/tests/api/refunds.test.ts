// Refunds the owner records against returns (bank-transfer orders): never more than the customer paid.
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { approvedReturn, cancelTestOrders, customer, deliver, must, orderRow, owner, pieces, placeOrder, sql, type Placed, type User } from "../helpers"
import { renderEmail } from "../../supabase/functions/_shared/emails/templates.ts"

let o: User
beforeAll(async () => {
  o = await owner()
})
afterAll(cancelTestOrders)

describe("a refund recorded against a return", () => {
  test("cannot be more than the customer paid for the order", async () => {
    const [piece] = await pieces(1)
    const c = await customer("refund")
    const r = await approvedReturn(o, c, [{ variant_id: piece.id, quantity: 1 }])
    const paid = (await orderRow(r.orderNumber)).total_cents
    // 500 euros typed against an order of a few dozen (a slipped decimal point does the same)
    const { data, error } = await o.sb.rpc("update_return", { p_return_id: r.returnId, p_action: "refund", p_refund_cents: 50_000, p_restock: false })
    expect(data, `a refund of 500.00 was recorded against an order of ${(paid / 100).toFixed(2)}`).toBeNull()
    expect(error?.message).toBe("refund_too_large")
    expect((await orderRow(r.orderNumber)).refunded_cents).toBe(0)
    const [ret] = await sql<{ status: string }>("select status from public.returns where id = $1", [r.returnId])
    expect(ret.status).toBe("approved")
  })

  test("of exactly what was paid goes through", async () => {
    const [piece] = await pieces(1)
    const c = await customer("refund-ok")
    const r = await approvedReturn(o, c, [{ variant_id: piece.id, quantity: 1 }])
    const paid = (await orderRow(r.orderNumber)).total_cents
    must(await o.sb.rpc("update_return", { p_return_id: r.returnId, p_action: "refund", p_refund_cents: paid, p_restock: false }))
    expect((await orderRow(r.orderNumber)).refunded_cents).toBe(paid)
  })

  test("in two parts cannot add up to more than was paid (delivery is not given back twice)", async () => {
    const [a, b] = await pieces(2)
    const c = await customer("two-parts")
    const placed = must(await placeOrder(c.sb, c.email, [{ variant_id: a.id, quantity: 1 }, { variant_id: b.id, quantity: 1 }])) as Placed
    const orderId = await deliver(o, placed.order_number)
    const order = await orderRow(placed.order_number)
    expect(order.shipping_cents).toBe(599)
    const lines = await sql<{ id: string; unit_price_cents: number }>("select id, unit_price_cents from public.order_items where order_id = $1 order by unit_price_cents, id", [orderId])
    const refunds: (string | undefined)[] = []
    for (const line of lines) {
      const number = must(await c.sb.rpc("request_return", { p_order_number: placed.order_number, p_items: [{ order_item_id: line.id, quantity: 1 }], p_reason: "changed_mind" })) as string
      const [{ id }] = await sql<{ id: string }>("select id from public.returns where return_number = $1", [number])
      must(await o.sb.rpc("update_return", { p_return_id: id, p_action: "approve", p_note: "check" }))
      // each part with the delivery charge on top, as the returns page suggested for both
      const { error } = await o.sb.rpc("update_return", { p_return_id: id, p_action: "refund", p_refund_cents: line.unit_price_cents + order.shipping_cents, p_restock: false })
      refunds.push(error?.message)
    }
    const after = await orderRow(placed.order_number)
    expect(after.refunded_cents, `refunded ${after.refunded_cents} on an order of ${after.total_cents}`).toBeLessThanOrEqual(after.total_cents)
    expect(refunds).toEqual([undefined, "refund_too_large"])
  })
})

describe("a return on an order with nothing left to refund", () => {
  test("can be closed with a refund of nothing", async () => {
    const [a, b] = await pieces(2)
    const c = await customer("nothing-left")
    const placed = must(await placeOrder(c.sb, c.email, [{ variant_id: a.id, quantity: 1 }, { variant_id: b.id, quantity: 1 }])) as Placed
    const orderId = await deliver(o, placed.order_number)
    // an order that was refunded too much before refunds were capped
    await sql("update public.orders set refunded_cents = total_cents + 46201 where id = $1", [orderId])
    const [line] = await sql<{ id: string }>("select id from public.order_items where order_id = $1 limit 1", [orderId])
    const number = must(await c.sb.rpc("request_return", { p_order_number: placed.order_number, p_items: [{ order_item_id: line.id, quantity: 1 }], p_reason: "changed_mind" })) as string
    const [{ id }] = await sql<{ id: string }>("select id from public.returns where return_number = $1", [number])
    must(await o.sb.rpc("update_return", { p_return_id: id, p_action: "approve", p_note: "check" }))
    const one = await o.sb.rpc("update_return", { p_return_id: id, p_action: "refund", p_refund_cents: 1, p_restock: false })
    expect(one.error?.message).toBe("refund_too_large")
    // after the first fix: refused even with 0, so the return stayed open for good
    must(await o.sb.rpc("update_return", { p_return_id: id, p_action: "refund", p_refund_cents: 0, p_restock: true }))
    const [ret] = await sql<{ status: string }>("select status from public.returns where id = $1", [id])
    expect(ret.status).toBe("refunded")
    // and the customer is not told that a refund of nothing is on its way
    const [{ data }] = await sql<{ data: unknown }>("select data from public.emails where return_id = $1 and kind = 'refund_sent'", [id])
    const email = renderEmail("refund_sent", data, { imageUrl: (p: string) => p })
    expect(`${email.subject}\n${email.text}`).not.toMatch(/on its way|we've sent/i)
    expect(email.text).toMatch(/no further refund/i)
  })

  test("with money left, a return can be closed without a refund, and the customer is told just that", async () => {
    const [piece] = await pieces(1)
    const c = await customer("zero")
    const r = await approvedReturn(o, c, [{ variant_id: piece.id, quantity: 1 }])
    // the parcel never came back, say: the owner closes the return without a refund
    must(await o.sb.rpc("update_return", { p_return_id: r.returnId, p_action: "refund", p_refund_cents: 0, p_restock: false }))
    const [{ data }] = await sql<{ data: unknown }>("select data from public.emails where return_id = $1 and kind = 'refund_sent'", [r.returnId])
    const email = renderEmail("refund_sent", data, { imageUrl: (p: string) => p })
    expect(email.text).toMatch(/closed without a refund/i)
    expect(email.text).not.toMatch(/on its way|already been returned/i)
  })
})
