// Card payments and cancelled orders. The shop's own payment code (supabase/functions/_shared/payments.ts) runs
// here against the local database and a stand-in for Stripe, so a payment page can be paid, expired, or have its
// refund fail, without a Stripe account.
import { createHmac } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import pg from "pg"
import { cancelTestOrders, customer, DB, must, orderRow, owner, person, pieces, placeOrder, setting, sql, URL_, visitor, type Placed, type User } from "../helpers"
import { handleCardPayment, handleStripeWebhook, type PayEnv } from "../../supabase/functions/_shared/payments.ts"
import { standIn } from "./stripe-stand-in"

let stripe: Awaited<ReturnType<typeof standIn>>
let env: PayEnv
let o: User
let ownerAuth: string
const WEBHOOK_SECRET = "stand-in-webhook-secret"

beforeAll(async () => {
  stripe = await standIn()
  env = {
    supabaseUrl: URL_, publicSupabaseUrl: URL_, serviceKey: process.env.TEST_SERVICE_KEY!, from: "Nordaloom <owner@nordaloom.example>",
    stripeKey: "stand-in-key", webhookSecret: WEBHOOK_SECRET, stripeApi: stripe.url,
  }
  o = await owner()
  ownerAuth = `Bearer ${(await o.sb.auth.getSession()).data.session!.access_token}`
})
beforeEach(cancelTestOrders)
afterAll(async () => {
  await stripe.close()
  await cancelTestOrders()
})

/** A customer places a card order and opens the payment page. */
async function orderWithOpenPage(quantity = 1) {
  const [piece] = await pieces(1)
  const c = await customer("card")
  const placed = must(await c.sb.rpc("place_order", {
    items: [{ variant_id: piece.id, quantity }],
    customer: { email: c.email, full_name: "Card Customer", phone: "+371 20000000", country: "LV", address_line1: "Brivibas iela 1", address_line2: "", city: "Riga", postal_code: "LV-1010" },
    shipping_code: "courier_lv", parcel_locker: "", payment_method: "card",
  })) as Placed
  await handleCardPayment(env, { action: "start", order_number: placed.order_number, token: placed.access_token }, null)
  const [{ id, stripe_session_id: page, total_cents: total }] = await sql<{ id: string; stripe_session_id: string; total_cents: number }>(
    "select id, stripe_session_id, total_cents from public.orders where order_number = $1", [placed.order_number])
  const stock = async () => (await sql<{ stock: number }>("select stock from public.product_variants where id = $1", [piece.id]))[0].stock
  return { ...placed, id, page, total, stock, stockBefore: piece.stock, customer: c }
}

/** The order is cancelled underneath an open payment page (the state the shop must cope with, however it got there). */
const cancelUnderneath = (orderId: string) =>
  sql(`with back as (update public.product_variants v set stock = v.stock + i.quantity from public.order_items i where i.order_id = $1 and i.variant_id = v.id)
       update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'by_shop' where id = $1`, [orderId])

function webhook(page: string, orderId: string) {
  const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: page, metadata: { order_id: orderId } } } })
  const t = Math.floor(Date.now() / 1000)
  const signature = `t=${t},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex")}`
  return handleStripeWebhook(env, payload, signature)
}

const refundsFor = (page: string) => stripe.refunds.filter((r) => r.payment_intent === stripe.pages.get(page)!.payment_intent)

describe("the owner cancels a card order whose payment page is still open", () => {
  test("the plain status change refuses, so the page cannot be left open", async () => {
    const order = await orderWithOpenPage()
    const { error } = await o.sb.rpc("set_order_status", { p_order_id: order.id, p_status: "cancelled" })
    const left = stripe.pages.get(order.page)!.status
    // as built: the order is cancelled, its pieces are back on sale, and the customer can still pay on the open page
    expect(`${error?.message ?? "cancelled"}, payment page ${left}`).toBe("card_page_open, payment page open")
  })

  test("cancelling through the payment function closes the page first: the customer can no longer pay", async () => {
    const order = await orderWithOpenPage()
    await handleCardPayment(env, { action: "cancel_order", order_id: order.id }, ownerAuth)
    expect(stripe.pages.get(order.page)!.status).toBe("expired")
    expect(() => stripe.pay(order.page)).toThrow()
    expect((await orderRow(order.order_number)).status).toBe("cancelled")
    expect(await order.stock()).toBe(order.stockBefore)
  })

  test("a payment made a moment before the cancellation is given back in full", async () => {
    const order = await orderWithOpenPage()
    // paid on Stripe's page; the shop hasn't heard yet
    stripe.pay(order.page)
    await handleCardPayment(env, { action: "cancel_order", order_id: order.id }, ownerAuth)
    const after = await orderRow(order.order_number)
    expect(after.status).toBe("cancelled")
    expect(refundsFor(order.page).map((r) => r.amount)).toEqual([order.total])
    expect(after.refunded_cents).toBe(order.total)
    expect(await order.stock()).toBe(order.stockBefore)
  })

  test("if Stripe does not close the page, the order is not cancelled", async () => {
    const order = await orderWithOpenPage()
    stripe.failNextCloses(1)
    await expect(handleCardPayment(env, { action: "cancel_order", order_id: order.id }, ownerAuth)).rejects.toThrow(/didn't close the payment page/)
    // the customer can still pay, so the order must still be there to be paid for
    expect(stripe.pages.get(order.page)!.status).toBe("open")
    expect((await orderRow(order.order_number)).status).toBe("awaiting_payment")
    expect(await order.stock()).toBe(order.stockBefore - 1)
    // the owner tries again a moment later
    await handleCardPayment(env, { action: "cancel_order", order_id: order.id }, ownerAuth)
    expect(stripe.pages.get(order.page)!.status).toBe("expired")
    expect((await orderRow(order.order_number)).status).toBe("cancelled")
  })

  test("if Stripe does not close the page, the order is not switched to bank transfer either", async () => {
    const order = await orderWithOpenPage()
    stripe.failNextCloses(1)
    await expect(handleCardPayment(env, { action: "switch_to_bank", order_number: order.order_number, token: order.access_token }, null)).rejects.toThrow(/didn't close the payment page/)
    const [{ payment_method }] = await sql<{ payment_method: string }>("select payment_method from public.orders where id = $1", [order.id])
    expect(payment_method).toBe("card")
    // a payment on the page that stayed open is still taken as the order's payment
    stripe.pay(order.page)
    await handleCardPayment(env, { action: "check", order_number: order.order_number, token: order.access_token }, null)
    expect((await orderRow(order.order_number)).status).toBe("paid")
  })

  test("a page Stripe no longer knows does not stop the order being cancelled", async () => {
    const order = await orderWithOpenPage()
    // the shop's Stripe keys were changed: Stripe answers "no such page"
    stripe.forget(order.page)
    await handleCardPayment(env, { action: "cancel_order", order_id: order.id }, ownerAuth)
    expect((await orderRow(order.order_number)).status).toBe("cancelled")
    expect(await order.stock()).toBe(order.stockBefore)
  })

  test("past its deadline, a card order can be cancelled by hand and cancels itself after six hours", async () => {
    const order = await orderWithOpenPage()
    stripe.forget(order.page)
    const refused = await o.sb.rpc("set_order_status", { p_order_id: order.id, p_status: "cancelled" })
    expect(refused.error?.message).toBe("card_page_open")
    // seven hours on: no payment page lives that long
    await sql("update public.orders set payment_due_at = now() - interval '7 hours' where id = $1", [order.id])
    await sql("select public.cancel_overdue_orders()")
    const after = await orderRow(order.order_number)
    expect(after.status).toBe("cancelled")
    expect(await order.stock()).toBe(order.stockBefore)
  })

  test("two cancel-and-refund requests at once put the pieces back once", async () => {
    const order = await orderWithOpenPage(2)
    stripe.pay(order.page)
    await webhook(order.page, order.id)
    expect((await orderRow(order.order_number)).status).toBe("paid")
    // Both requests have refunded the card (Stripe makes that one refund) and now record the cancellation;
    // the second starts before the first has finished.
    const first = new pg.Client({ connectionString: DB })
    const second = new pg.Client({ connectionString: DB })
    await Promise.all([first.connect(), second.connect()])
    try {
      await first.query("begin")
      await first.query("select public.record_card_cancellation($1, $2)", [order.id, order.total])
      const waiting = second.query("select public.record_card_cancellation($1, $2)", [order.id, order.total])
      await new Promise((r) => setTimeout(r, 400))
      await first.query("commit")
      await waiting
    } finally {
      await Promise.all([first.end(), second.end()])
    }
    const after = await orderRow(order.order_number)
    expect([after.status, after.refunded_cents]).toEqual(["cancelled", order.total])
    // as built: the two pieces are put back twice, so the shelf shows two that are not there
    expect(await order.stock(), "pieces on the shelf").toBe(order.stockBefore)
  })
})

describe("a second payment for an order that is already paid", () => {
  test("is sent back, and the order stays paid once", async () => {
    const order = await orderWithOpenPage()
    stripe.pay(order.page)
    await webhook(order.page, order.id)
    // another page for the same order gets paid as well (it should not exist; if it does, the money goes back)
    const second = stripe.open(order.id, order.order_number, order.total)
    stripe.pay(second)
    await webhook(second, order.id)
    expect(refundsFor(second).map((r) => r.amount)).toEqual([order.total])
    expect(refundsFor(order.page)).toEqual([])
    const after = await orderRow(order.order_number)
    expect([after.status, after.refunded_cents]).toEqual(["paid", 0])
  })
})

describe("a card payment that lands on an order already cancelled", () => {
  test("is refunded when Stripe's notice is repeated after the first refund attempt failed", async () => {
    const order = await orderWithOpenPage()
    await cancelUnderneath(order.id)
    stripe.pay(order.page)
    stripe.failNextRefunds(1)
    // Stripe tells the shop; the refund fails; Stripe tells the shop again a little later
    await expect(webhook(order.page, order.id)).rejects.toThrow(/refunds are failing/)
    await webhook(order.page, order.id)
    // as built: the second notice answers "paid" and nothing is refunded; the customer is out the whole amount
    expect(refundsFor(order.page).map((r) => r.amount), `no refund of ${(order.total / 100).toFixed(2)} for a cancelled order`).toEqual([order.total])
    expect((await orderRow(order.order_number)).refunded_cents).toBe(order.total)
  })

  test("is refunded once, however many times the notice arrives", async () => {
    const order = await orderWithOpenPage()
    await cancelUnderneath(order.id)
    stripe.pay(order.page)
    await Promise.all([webhook(order.page, order.id), webhook(order.page, order.id)])
    await webhook(order.page, order.id)
    expect(refundsFor(order.page)).toHaveLength(1)
    expect((await orderRow(order.order_number)).refunded_cents).toBe(order.total)
  })

  test("when nothing was paid, the shop asks Stripe once and then stops asking", async () => {
    const order = await orderWithOpenPage()
    await cancelUnderneath(order.id)
    stripe.expire(order.page)
    const asked = () => stripe.calls.filter((c) => c.includes(order.page)).length
    const before = asked()
    for (let i = 0; i < 3; i++) await handleCardPayment(env, { action: "check", order_number: order.order_number, token: order.access_token }, null)
    expect(asked() - before).toBe(1)
  })

  test("is refunded when the customer comes back from the payment page, without waiting for Stripe's notice", async () => {
    const order = await orderWithOpenPage()
    await cancelUnderneath(order.id)
    stripe.pay(order.page)
    // what the order page does when the customer returns from Stripe
    await handleCardPayment(env, { action: "check", order_number: order.order_number, token: order.access_token }, null)
    expect(refundsFor(order.page).map((r) => r.amount), "paid, order cancelled, nothing refunded").toEqual([order.total])
    expect((await orderRow(order.order_number)).refunded_cents).toBe(order.total)
  })
})

describe("a card order that was paid while the shop could not ask Stripe", () => {
  test("and then cancelled itself as unpaid: the two-minute check finds the payment and sends it back", async () => {
    const order = await orderWithOpenPage()
    stripe.pay(order.page)
    // Stripe could not be asked for seven hours (its key was being changed): the order cancels itself
    await sql("update public.orders set payment_due_at = now() - interval '7 hours' where id = $1", [order.id])
    await sql("select public.cancel_overdue_orders()")
    expect((await orderRow(order.order_number)).status).toBe("cancelled")
    // Stripe can be asked again; the check that runs every two minutes
    await handleCardPayment(env, { action: "sync" }, null)
    // after the second fix: nothing, until the customer happened to come back through the payment page's own link
    expect(refundsFor(order.page).map((r) => r.amount), "paid, cancelled as unpaid, nothing returned").toEqual([order.total])
    expect((await orderRow(order.order_number)).refunded_cents).toBe(order.total)
  })

  test("the two-minute check asks about a cancelled, unpaid order once and no more", async () => {
    const order = await orderWithOpenPage()
    await cancelUnderneath(order.id)
    stripe.expire(order.page)
    const asked = () => stripe.calls.filter((c) => c.includes(order.page)).length
    const before = asked()
    for (let i = 0; i < 3; i++) await handleCardPayment(env, { action: "sync" }, null)
    expect(asked() - before).toBe(1)
  })
})

describe("switching a card order to bank transfer", () => {
  test("is held to the limit of three orders waiting for a transfer per email address", async () => {
    const [piece] = await pieces(1)
    const email = `switch-${crypto.randomUUID().slice(0, 10)}@example.test`
    const items = [{ variant_id: piece.id, quantity: 1 }]
    for (let i = 0; i < 3; i++) must(await placeOrder(visitor(), email, items))
    // a fourth order gets past the limit as a card order ...
    const placed = must(await visitor().rpc("place_order", { items, customer: person(email), shipping_code: "courier_lv", parcel_locker: "", payment_method: "card" })) as Placed
    await handleCardPayment(env, { action: "start", order_number: placed.order_number, token: placed.access_token }, null)
    // ... and is then switched
    await expect(handleCardPayment(env, { action: "switch_to_bank", order_number: placed.order_number, token: placed.access_token }, null)).rejects.toThrow("too_many_unpaid")
    // after the second fix: a fourth, fifth, … order waiting for a transfer, each with its email of bank details
    const waiting = await sql("select 1 from public.orders where email = $1 and status = 'awaiting_payment' and payment_method = 'bank_transfer'", [email])
    expect(waiting).toHaveLength(3)
  })
})

describe("switching a card order without an account to bank transfer", () => {
  test("is held to the shop-wide limit on orders waiting for a transfer", async () => {
    const [piece] = await pieces(1)
    const placed = must(await visitor().rpc("place_order", {
      items: [{ variant_id: piece.id, quantity: 1 }], customer: person(`switch-guest-${crypto.randomUUID().slice(0, 10)}@example.test`),
      shipping_code: "courier_lv", parcel_locker: "", payment_method: "card",
    })) as Placed
    await handleCardPayment(env, { action: "start", order_number: placed.order_number, token: placed.access_token }, null)
    // no room left for another order without an account waiting for a transfer
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from public.orders o where o.user_id is null and o.status = 'awaiting_payment' and o.payment_method = 'bank_transfer' and not exists (select 1 from public.demo_people d where d.email = lower(o.email))")
    const restore = await setting("guest_bank_orders_waiting", n)
    try {
      await expect(handleCardPayment(env, { action: "switch_to_bank", order_number: placed.order_number, token: placed.access_token }, null)).rejects.toThrow("too_many_guest_orders")
    } finally {
      await restore()
    }
    const [{ payment_method }] = await sql<{ payment_method: string }>("select payment_method from public.orders where order_number = $1", [placed.order_number])
    expect(payment_method).toBe("card")
  })
})

describe("the address the customer comes back to from the payment page", () => {
  const back = (page: string) => {
    const { success_url, cancel_url } = stripe.pages.get(page)!
    return [new URL(success_url!), new URL(cancel_url!)]
  }

  test("carries no key for an order that belongs to an account; the order opens by signing in", async () => {
    const order = await orderWithOpenPage()
    for (const [url, card] of back(order.page).map((u, i) => [u, i === 0 ? "return" : "cancelled"] as const)) {
      expect(url.pathname).toBe(`/order/${order.order_number}`)
      // as built: ?token=<the order's key>&card=return, kept in the browser's history after the customer signs out
      expect(url.searchParams.has("token"), `${url} carries the order's key`).toBe(false)
      expect(url.search).not.toContain(order.access_token)
      expect(url.searchParams.get("card")).toBe(card)
    }
    // signed in, the page opens the order and asks how the payment went, without the key
    const c = order.customer
    expect(must(await c.sb.rpc("get_order", { p_order_number: order.order_number, p_token: null }))).not.toBeNull()
    const auth = `Bearer ${(await c.sb.auth.getSession()).data.session!.access_token}`
    stripe.pay(order.page)
    expect(await handleCardPayment(env, { action: "check", order_number: order.order_number, token: null }, auth)).toMatchObject({ status: "paid" })
    // signed out, nothing of it
    expect(must(await visitor().rpc("get_order", { p_order_number: order.order_number, p_token: null }))).toBeNull()
    await expect(handleCardPayment(env, { action: "check", order_number: order.order_number, token: null }, null)).rejects.toThrow("not_found")
  })

  test("keeps the key for an order without an account: it is the guest's only way back", async () => {
    const [piece] = await pieces(1)
    const placed = must(await visitor().rpc("place_order", {
      items: [{ variant_id: piece.id, quantity: 1 }], customer: person(`return-guest-${crypto.randomUUID().slice(0, 10)}@example.test`),
      shipping_code: "courier_lv", parcel_locker: "", payment_method: "card",
    })) as Placed
    await handleCardPayment(env, { action: "start", order_number: placed.order_number, token: placed.access_token }, null)
    const [{ stripe_session_id: page }] = await sql<{ stripe_session_id: string }>("select stripe_session_id from public.orders where order_number = $1", [placed.order_number])
    const [success, cancel] = back(page)
    expect(success.pathname).toBe(`/order/${placed.order_number}`)
    expect([success.searchParams.get("token"), success.searchParams.get("card")]).toEqual([placed.access_token, "return"])
    expect([cancel.searchParams.get("token"), cancel.searchParams.get("card")]).toEqual([placed.access_token, "cancelled"])
  })
})

describe("a return on a card order", () => {
  test("can be closed without a refund", async () => {
    const order = await orderWithOpenPage()
    stripe.pay(order.page)
    await webhook(order.page, order.id)
    for (const status of ["shipped", "delivered"]) must(await o.sb.rpc("set_order_status", { p_order_id: order.id, p_status: status, p_tracking: "CHECK-1" }))
    const [line] = await sql<{ id: string }>("select id from public.order_items where order_id = $1", [order.id])
    const number = must(await order.customer.sb.rpc("request_return", { p_order_number: order.order_number, p_items: [{ order_item_id: line.id, quantity: 1 }], p_reason: "changed_mind" })) as string
    const [{ id: returnId }] = await sql<{ id: string }>("select id from public.returns where return_number = $1", [number])
    must(await o.sb.rpc("update_return", { p_return_id: returnId, p_action: "approve", p_note: "check" }))
    // closed without a refund: nothing goes to Stripe
    await handleCardPayment(env, { action: "refund_return", return_id: returnId, amount_cents: 0, restock: true }, ownerAuth)
    const [ret] = await sql<{ status: string; refund_cents: number }>("select status, refund_cents from public.returns where id = $1", [returnId])
    expect([ret.status, ret.refund_cents]).toEqual(["refunded", 0])
    expect(refundsFor(order.page)).toEqual([])
  })
})
