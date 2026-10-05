// Placing an order: sent twice, sent again with something else, at a price that moved, and too many unpaid ones.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "vitest"
import pg from "pg"
import { cancelTestOrders, customer, DB, must, orderRow, owner, person, pieces, placeOrder, setting, sql, visitor, visitorLimitOn, type Placed } from "../helpers"

// each check starts with no unpaid test orders (the limits below count them)
beforeEach(cancelTestOrders)
afterAll(cancelTestOrders)

const guestEmail = (tag: string) => `${tag}-${crypto.randomUUID().slice(0, 10)}@example.test`

describe("the same order sent again", () => {
  test("pressing twice makes one order", async () => {
    const [piece] = await pieces(1)
    const sb = visitor()
    const email = guestEmail("twice")
    const key = crypto.randomUUID()
    const items = [{ variant_id: piece.id, quantity: 1 }]
    const first = must(await placeOrder(sb, email, items, { client_key: key })) as Placed
    const second = must(await placeOrder(sb, email, items, { client_key: key })) as Placed
    expect(second.order_number).toBe(first.order_number)
    expect(second.already_placed).toBe(true)
    const made = await sql("select 1 from public.orders where email = $1", [email])
    expect(made).toHaveLength(1)
  })

  test("a different bag and a different person on the same device get their own order, not the earlier one", async () => {
    const [a, b] = await pieces(2)
    const sb = visitor()
    const one = guestEmail("person-one")
    const two = guestEmail("person-two")
    // what the checkout keeps on the device for 12 hours after an answer was lost
    const key = crypto.randomUUID()
    const first = must(await placeOrder(sb, one, [{ variant_id: a.id, quantity: 1 }], { client_key: key })) as Placed

    const answer = await sb.rpc("place_order", {
      items: [{ variant_id: b.id, quantity: 2 }],
      customer: { ...person(two, "Person Two"), address_line1: "Another street 5" },
      shipping_code: "courier_lv",
      parcel_locker: "",
      client_key: key,
    })
    const second = must(answer) as Placed
    // as built: the first person's order number and its access token (name, address, phone) come back
    expect(second.order_number, "the second person was handed the first person's order").not.toBe(first.order_number)
    expect(second.access_token).not.toBe(first.access_token)
    const theirs = await sql<{ email: string; pieces: number }>(
      "select o.email, (select sum(quantity)::int from public.order_items i where i.order_id = o.id) as pieces from public.orders o where o.email = $1", [two])
    expect(theirs).toEqual([{ email: two, pieces: 2 }])
  })

  test("a changed letter case in the name does not make a second order", async () => {
    const [piece] = await pieces(1)
    const sb = visitor()
    const email = guestEmail("case")
    const key = crypto.randomUUID()
    const send = (name: string) => sb.rpc("place_order", { items: [{ variant_id: piece.id, quantity: 1 }], customer: { ...person(email, name) }, shipping_code: "courier_lv", parcel_locker: "", client_key: key })
    const first = must(await send("Anna Berzina")) as Placed
    const second = must(await send("anna berzina")) as Placed
    expect(second.order_number).toBe(first.order_number)
  })

  test("a separator typed into a field cannot make two different orders look the same", async () => {
    const [piece] = await pieces(1)
    const sb = visitor()
    const email = guestEmail("bar")
    const key = crypto.randomUUID()
    const send = (name: string, phone: string) =>
      sb.rpc("place_order", { items: [{ variant_id: piece.id, quantity: 1 }], customer: { ...person(email, name), phone }, shipping_code: "courier_lv", parcel_locker: "", client_key: key })
    const first = must(await send("Ab|+371 20", "000000")) as Placed
    const second = must(await send("Ab", "+371 20|000000")) as Placed
    expect(second.order_number).not.toBe(first.order_number)
  })

  test("an order that was cancelled is not handed back as already placed", async () => {
    const [piece] = await pieces(1)
    const c = await customer("cancelled-key")
    const key = crypto.randomUUID()
    const items = [{ variant_id: piece.id, quantity: 1 }]
    const first = must(await placeOrder(c.sb, c.email, items, { client_key: key })) as Placed
    const o = await owner()
    must(await o.sb.rpc("set_order_status", { p_order_id: (await orderRow(first.order_number)).id, p_status: "cancelled" }))
    // the customer presses again on the checkout that is still open
    const again = must(await placeOrder(c.sb, c.email, items, { client_key: key })) as Placed
    // as built: the cancelled order comes back as "already placed", and the page empties the bag
    expect(again.already_placed ?? false, "the cancelled order was handed back as placed").toBe(false)
    expect(again.order_number).not.toBe(first.order_number)
    expect((await orderRow(again.order_number)).status).toBe("awaiting_payment")
  })
})

describe("what an order may contain", () => {
  test("an order with no list of pieces is refused", async () => {
    const sb = visitor()
    const email = guestEmail("nothing")
    const { data, error } = await sb.rpc("place_order", { items: null, customer: person(email), shipping_code: "courier_lv", parcel_locker: "" })
    // as built: an order with no pieces, total 5.99, and a "how to pay" email
    expect(data, "an order with nothing in it was made").toBeNull()
    expect(error?.message).toBe("empty_cart")
    expect(await sql("select 1 from public.orders where email = $1", [email])).toHaveLength(0)
  })

  test("one order holds at most 40 pieces", async () => {
    const [a, b, c] = await pieces(3)
    const { data, error } = await placeOrder(visitor(), guestEmail("shelf"), [{ variant_id: a.id, quantity: 20 }, { variant_id: b.id, quantity: 20 }, { variant_id: c.id, quantity: 1 }])
    expect(data).toBeNull()
    expect(error?.message).toBe("order_too_large")
  })
})

describe("the amount the customer agreed to", () => {
  test("an order is refused when its total is not the one on the button", async () => {
    const [piece] = await pieces(1)
    const c = await customer("price")
    // the button said 1 euro less than the shop will charge (the price went up while the checkout was open)
    const shown = piece.price + 599 - 100
    const { data, error } = await placeOrder(c.sb, c.email, [{ variant_id: piece.id, quantity: 1 }], { expected_total_cents: shown })
    expect(data, "an order was made at a total the customer never saw").toBeNull()
    expect(error?.message).toBe("price_changed")
    expect(await sql("select 1 from public.orders where email = $1", [c.email])).toHaveLength(0)
  })

  test("an order at the total on the button goes through", async () => {
    const [piece] = await pieces(1)
    const c = await customer("price-ok")
    const placed = must(await placeOrder(c.sb, c.email, [{ variant_id: piece.id, quantity: 1 }], { expected_total_cents: piece.price + 599 })) as Placed
    expect((await orderRow(placed.order_number)).total_cents).toBe(piece.price + 599)
  })
})

describe("orders nobody has paid for", () => {
  test("one email address cannot collect more than three unpaid orders", async () => {
    const [piece] = await pieces(1)
    const sb = visitor()
    const email = guestEmail("victim")
    const items = [{ variant_id: piece.id, quantity: 1 }]
    for (let i = 0; i < 3; i++) must(await placeOrder(sb, email, items))
    const fourth = await placeOrder(sb, email, items)
    expect(fourth.data, "a fourth payment email with bank details went to the same address").toBeNull()
    expect(fourth.error?.message).toBe("too_many_unpaid")
  })

  test("an address with a +tag counts as the same mailbox", async () => {
    const [piece] = await pieces(1)
    const sb = visitor()
    const id = crypto.randomUUID().slice(0, 10)
    const items = [{ variant_id: piece.id, quantity: 1 }]
    for (let i = 1; i <= 3; i++) must(await placeOrder(sb, `tagged-${id}+${i}@example.test`, items))
    const fourth = await placeOrder(sb, `tagged-${id}+4@example.test`, items)
    expect(fourth.error?.message).toBe("too_many_unpaid")
  })

  test("unpaid orders someone else typed a customer's address into do not stop that customer ordering", async () => {
    const [piece] = await pieces(1)
    const c = await customer("blocked")
    const items = [{ variant_id: piece.id, quantity: 1 }]
    // a stranger, not signed in, orders three times with the customer's email address
    for (let i = 0; i < 3; i++) must(await placeOrder(visitor(), c.email, items))
    const own = await placeOrder(c.sb, c.email, items)
    expect(own.error?.message, "the customer's own order").toBeUndefined()
    // and by card nobody is held to the limit on bank-transfer emails
    const byCard = await placeOrder(visitor(), c.email, items, { payment_method: "card" })
    expect(byCard.error?.message, "a card order to the same address").toBeUndefined()
  })
})

describe("one visitor, with the limit per visitor switched on", () => {
  let restore: () => Promise<unknown>
  beforeEach(async () => {
    restore = await visitorLimitOn()
  })
  afterEach(() => restore())

  test("cannot hold stock with order after order", async () => {
    const [piece] = await pieces(1, 12)
    const sb = visitor()
    const items = [{ variant_id: piece.id, quantity: 1 }]
    const results: string[] = []
    // twelve orders to twelve different addresses, as a script would send them
    for (let i = 0; i < 12; i++) {
      const r = await placeOrder(sb, guestEmail(`flood${i}`), items)
      results.push(r.error?.message ?? "placed")
    }
    const placed = results.filter((r) => r === "placed").length
    expect(placed, `twelve orders in a row from one visitor: ${results.join(", ")}`).toBeLessThanOrEqual(8)
    expect(results.at(-1)).toBe("too_many_orders")
  })

  test("is counted the same when signed in", async () => {
    const [piece] = await pieces(1, 12)
    const items = [{ variant_id: piece.id, quantity: 1 }]
    for (let i = 0; i < 8; i++) must(await placeOrder(visitor(), guestEmail(`before${i}`), items))
    const c = await customer("signed-in")
    const r = await placeOrder(c.sb, c.email, items)
    expect(r.error?.message).toBe("too_many_orders")
  })

  test("card orders that cancelled themselves unpaid still count for the day", async () => {
    const [piece] = await pieces(1, 12)
    const items = [{ variant_id: piece.id, quantity: 1 }]
    const emails: string[] = []
    for (let i = 0; i < 8; i++) {
      emails.push(guestEmail(`card${i}`))
      must(await placeOrder(visitor(), emails[i], items, { payment_method: "card" }))
    }
    // forty minutes later nobody has paid: the shop cancels them
    await sql("update public.orders set payment_due_at = now() - interval '1 minute' where email = any($1)", [emails])
    await sql("select public.cancel_overdue_orders()")
    expect(await sql("select 1 from public.orders where email = any($1) and status = 'cancelled'", [emails])).toHaveLength(8)
    const next = await placeOrder(visitor(), guestEmail("card-next"), items, { payment_method: "card" })
    expect(next.error?.message, "a ninth order from the same visitor within the day").toBe("too_many_orders")
  })

  test("the visitor's address is not kept on the order, and nobody can read where orders came from", async () => {
    const [piece] = await pieces(1)
    const sb = visitor()
    const placed = must(await placeOrder(sb, guestEmail("origin"), [{ variant_id: piece.id, quantity: 1 }])) as Placed
    const order = must(await sb.rpc("get_order", { p_order_number: placed.order_number, p_token: placed.access_token })) as Record<string, unknown>
    expect(Object.keys(order).filter((k) => /placed_from|address_hash|origin/.test(k))).toEqual([])
    const [origin] = await sql<{ address: string }>("select g.address from public.order_origins g join public.orders o on o.id = g.order_id where o.order_number = $1", [placed.order_number])
    // a hash made with the shop's own secret, not an address and not a plain md5 of one
    expect(origin.address).toMatch(/^[0-9a-f]{64}$/)
    const o = await owner()
    for (const who of [sb, o.sb]) {
      const read = await who.from("order_origins").select("*")
      expect(read.data ?? []).toEqual([])
    }
  })
})

describe("orders without an account, counted for the whole shop, with the limit per visitor off", () => {
  let restore: (() => Promise<unknown>)[] = []
  beforeEach(async () => {
    // proxy_hops = 0 is how the shop starts on a new host: the limit per visitor is off
    restore = [await setting("proxy_hops", 0)]
  })
  afterEach(async () => {
    for (const r of restore.reverse()) await r()
  })

  const waitingByTransfer = async () =>
    (await sql<{ n: number }>("select count(*)::int as n from public.orders o where o.user_id is null and o.status = 'awaiting_payment' and o.payment_method = 'bank_transfer' and not exists (select 1 from public.demo_people d where d.email = lower(o.email))"))[0].n
  const lastHour = async () =>
    (await sql<{ n: number }>(`select count(*)::int as n from public.orders o
      where o.user_id is null and o.created_at > now() - interval '1 hour' and o.paid_at is null and o.status in ('awaiting_payment', 'cancelled')
        and not exists (select 1 from public.demo_people d where d.email = lower(o.email))`))[0].n

  test("only so many wait for a bank transfer at once; then a guest pays by card or signs in", async () => {
    const [piece] = await pieces(1)
    const items = [{ variant_id: piece.id, quantity: 1 }]
    // room for two more than are waiting now
    restore.push(await setting("guest_bank_orders_waiting", (await waitingByTransfer()) + 2))
    for (let i = 0; i < 2; i++) must(await placeOrder(visitor(), guestEmail(`waiting${i}`), items))
    const email = guestEmail("waiting-over")
    const over = await placeOrder(visitor(), email, items)
    // as built: a new address for each order, and there is no end to orders holding stock and sending bank details
    expect(over.data, "a bank transfer order over the shop's limit").toBeNull()
    expect([over.error?.message, over.error?.details]).toEqual(["too_many_guest_orders", "bank_transfer"])
    expect(await sql("select 1 from public.orders where email = $1", [email])).toHaveLength(0)
    // paying by card is not held to it
    expect((await placeOrder(visitor(), email, items, { payment_method: "card" })).error?.message, "a guest paying by card").toBeUndefined()
    // and a signed-in customer never is
    const c = await customer("waiting-signed-in")
    expect((await placeOrder(c.sb, c.email, items)).error?.message, "a signed-in customer paying by bank transfer").toBeUndefined()
  })

  test("only so many are placed in an hour that are unpaid or were cancelled unpaid, however they are paid", async () => {
    const [piece] = await pieces(1)
    const items = [{ variant_id: piece.id, quantity: 1 }]
    // room for three more than the last hour has had
    restore.push(await setting("guest_orders_per_hour", (await lastHour()) + 3))
    const cards = [guestEmail("hour-card0"), guestEmail("hour-card1")]
    for (const email of cards) must(await placeOrder(visitor(), email, items, { payment_method: "card" }))
    // forty minutes later nobody has paid: the shop cancels them, and they still count for the hour
    await sql("update public.orders set payment_due_at = now() - interval '1 minute' where email = any($1)", [cards])
    await sql("select public.cancel_overdue_orders()")
    expect(await sql("select 1 from public.orders where email = any($1) and status = 'cancelled'", [cards])).toHaveLength(2)
    must(await placeOrder(visitor(), guestEmail("hour-bank"), items))
    for (const method of ["card", "bank_transfer"]) {
      const email = guestEmail(`hour-over-${method}`)
      const over = await placeOrder(visitor(), email, items, { payment_method: method })
      // as built: card orders without an account are not limited at all; each holds its pieces for 40 minutes
      expect(over.data, `a ${method} order over the shop's limit for the hour`).toBeNull()
      expect([over.error?.message, over.error?.details]).toEqual(["too_many_guest_orders", "hour"])
      expect(await sql("select 1 from public.orders where email = $1", [email])).toHaveLength(0)
    }
    // a signed-in customer is not refused by it, by card or by bank transfer
    const c = await customer("hour-signed-in")
    for (const method of ["card", "bank_transfer"]) {
      expect((await placeOrder(c.sb, c.email, items, { payment_method: method })).error?.message, `a signed-in customer paying by ${method}`).toBeUndefined()
    }
  })
})

const demoGuestOrders = (await sql<{ n: number }>(
  "select count(*)::int as n from public.orders o where o.user_id is null and o.payment_method = 'bank_transfer' and lower(o.email) in (select email from public.demo_people)"))[0].n

describe("the made-up history's orders without an account", () => {
  test.skipIf(demoGuestOrders < 3)("do not take the room of real guests waiting for a bank transfer", async () => {
    const [piece] = await pieces(1)
    const db = new pg.Client({ connectionString: DB })
    await db.connect()
    try {
      // tried and then undone: nothing of it stays
      await db.query("begin")
      // as when the history has just been loaded: some of its guest orders still wait for a transfer
      await db.query(`update public.orders set status = 'awaiting_payment' where id in (
        select o.id from public.orders o where o.user_id is null and o.payment_method = 'bank_transfer'
          and lower(o.email) in (select email from public.demo_people) limit 3)`)
      const { rows: [{ n }] } = await db.query(`select count(*)::int as n from public.orders o
        where o.user_id is null and o.status = 'awaiting_payment' and o.payment_method = 'bank_transfer'
          and lower(o.email) not in (select email from public.demo_people)`)
      // room for exactly one real guest order
      await db.query("update public.shop_settings set guest_bank_orders_waiting = $1, guest_orders_per_hour = 100000", [n + 1])
      await db.query("set local role anon")
      const placed = await db.query("select public.place_order(items => $1::jsonb, customer => $2::jsonb, shipping_code => 'courier_lv') as r",
        [JSON.stringify([{ variant_id: piece.id, quantity: 1 }]), JSON.stringify(person(guestEmail("beside-history")))]).then(() => "placed", (e: Error) => e.message)
      expect(placed, "a real guest's order, with the history's orders waiting").toBe("placed")
    } finally {
      await db.query("rollback")
      await db.end()
    }
  })
})

describe("an attempt whose answer was lost", () => {
  test("can be asked about with its key, but only for the email address it was sent with", async () => {
    const [piece] = await pieces(1)
    const sb = visitor()
    const email = guestEmail("asked")
    const key = crypto.randomUUID()
    const placed = must(await placeOrder(sb, email, [{ variant_id: piece.id, quantity: 1 }], { client_key: key })) as Placed
    const own = must(await sb.rpc("earlier_attempt", { p_key: key, p_email: email.toUpperCase() })) as Record<string, unknown>[]
    expect(own.map((o) => o.order_number)).toEqual([placed.order_number])
    // no more than the number, the total and the way of paying: nothing that opens the order
    expect(Object.keys(own[0]).sort()).toEqual(["order_number", "payment_method", "total_cents"])
    expect(must(await sb.rpc("earlier_attempt", { p_key: key, p_email: guestEmail("someone-else") }))).toEqual([])
    expect(must(await sb.rpc("earlier_attempt", { p_key: crypto.randomUUID(), p_email: email }))).toEqual([])
  })
})
