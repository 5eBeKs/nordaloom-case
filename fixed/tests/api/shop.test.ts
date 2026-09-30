// Discount codes from the made-up history, the email when the shop cancels an order, the shop's settings as a
// visitor sees them, and what a customer has spent.
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import pg from "pg"
import { approvedReturn, cancelTestOrders, customer, DB, emailsFor, must, orderRow, owner, pieces, placeOrder, sql, visitor, type Placed, type User } from "../helpers"
import { renderEmail } from "../../supabase/functions/_shared/emails/templates.ts"

let o: User
beforeAll(async () => {
  o = await owner()
})
afterAll(cancelTestOrders)

const demoCodes = (await sql<{ code: string }>("select code from public.demo_codes")).map((r) => r.code)

describe("codes that belong to the made-up history", () => {
  test.skipIf(!demoCodes.includes("THANKYOU20"))("cannot be used by a real customer", async () => {
    const [piece] = await pieces(1)
    const c = await customer("code")
    const check = must(await c.sb.rpc("check_discount", { p_code: "THANKYOU20", p_subtotal_cents: piece.price, p_email: c.email })) as { ok: boolean; discount_cents?: number }
    expect(check.ok, `20% off (${((check.discount_cents ?? 0) / 100).toFixed(2)}) offered to a customer who isn't part of the history`).toBe(false)
    const { data, error } = await placeOrder(c.sb, c.email, [{ variant_id: piece.id, quantity: 1 }], { discount_code: "THANKYOU20" })
    expect(data).toBeNull()
    expect(error?.message).toBe("discount_invalid")
  })

  test.skipIf(demoCodes.length === 0)("do not stop the history from being removed once a real order has used one", async () => {
    const [piece] = await pieces(1)
    const c = await customer("code-used")
    const placed = must(await placeOrder(c.sb, c.email, [{ variant_id: piece.id, quantity: 1 }])) as Placed
    const db = new pg.Client({ connectionString: DB })
    await db.connect()
    try {
      // tried and then undone: the history stays in place for the other checks
      await db.query("begin")
      await db.query("update public.orders set discount_code_id = (select id from public.discount_codes where code = $1), discount_code = $1 where order_number = $2", [demoCodes[0], placed.order_number])
      const removed = await db.query("select public.remove_demo_history() as r").then((r) => r.rows[0].r, (e: Error) => e.message)
      expect(removed, "removing the made-up history failed").toMatchObject({ orders: expect.any(Number) })
      const left = await db.query("select count(*)::int as n from public.orders where email in (select email from public.demo_people)")
      expect(left.rows[0].n).toBe(0)
      // the real order keeps its code, which can no longer be used
      const code = await db.query("select is_active from public.discount_codes where code = $1", [demoCodes[0]])
      expect(code.rows).toEqual([{ is_active: false }])
    } finally {
      await db.query("rollback")
      await db.end()
    }
  })
})

describe("when the shop cancels an order that is waiting for a bank transfer", () => {
  test("the customer is told, and told not to pay", async () => {
    const [piece] = await pieces(1)
    const c = await customer("cancelled")
    const placed = must(await placeOrder(c.sb, c.email, [{ variant_id: piece.id, quantity: 1 }])) as Placed
    expect(await emailsFor(placed.order_number)).toEqual(["order_confirmation"])
    const { id } = await orderRow(placed.order_number)
    must(await o.sb.rpc("set_order_status", { p_order_id: id, p_status: "cancelled" }))
    // as built: the customer keeps an email with the bank details and the amount, and hears nothing else
    expect(await emailsFor(placed.order_number), "no email about the cancellation").toEqual(["order_confirmation", "order_cancelled"])
    const [{ data }] = await sql<{ data: unknown }>("select e.data from public.emails e join public.orders o on o.id = e.order_id where o.order_number = $1 and e.kind = 'order_cancelled'", [placed.order_number])
    const email = renderEmail("order_cancelled", data, { imageUrl: (p: string) => p })
    expect(email.text).not.toMatch(/didn't receive the payment/i)
    expect(email.text).toMatch(/(don't|do not) (send|pay|make)/i)
  })
})

describe("the shop's settings, read by a visitor who is not signed in", () => {
  test("do not include the address of the server functions or the welcome code", async () => {
    const all = await visitor().from("shop_settings").select("*")
    const row = (all.data?.[0] ?? {}) as Record<string, unknown>
    expect(Object.keys(row).filter((k) => ["functions_url", "welcome_discount_code", "email_sending_since"].includes(k)), "readable without signing in").toEqual([])
    for (const column of ["functions_url", "welcome_discount_code", "email_sending_since"]) {
      const one = await visitor().from("shop_settings").select(column)
      expect(one.data, `${column} is readable without signing in`).toBeNull()
    }
  })

  test("still include what the shop pages show", async () => {
    const row = must(await visitor().from("shop_settings").select("free_shipping_threshold_cents, payment_days, return_days, return_address, low_stock_threshold, contact_email").single())
    expect(row.free_shipping_threshold_cents).toBeGreaterThan(0)
  })

  test("are still all there for the owner's Emails page", async () => {
    const s = must(await o.sb.rpc("admin_settings")) as Record<string, unknown>
    expect(Object.keys(s)).toEqual(expect.arrayContaining(["site_url", "contact_email", "welcome_discount_code"]))
  })
})

describe("what a customer has spent, in the owner's customer list", () => {
  test("does not count money that was refunded", async () => {
    const [piece] = await pieces(1)
    const c = await customer("spent")
    const r = await approvedReturn(o, c, [{ variant_id: piece.id, quantity: 1 }])
    const paid = (await orderRow(r.orderNumber)).total_cents
    must(await o.sb.rpc("update_return", { p_return_id: r.returnId, p_action: "refund", p_refund_cents: paid, p_restock: false }))
    const list = must(await o.sb.rpc("admin_customers")) as { email: string; spent_cents: number }[]
    const row = list.find((x) => x.email === c.email)!
    expect(row.spent_cents, `everything was refunded, the list still says ${(row.spent_cents / 100).toFixed(2)} spent`).toBe(0)
  })
})
