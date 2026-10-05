// Who can open an order's page data: the holder of its link, the account that placed it, the owner. Nobody else.
import { afterAll, beforeEach, describe, expect, test } from "vitest"
import { cancelTestOrders, customer, must, pieces, placeOrder, sql, visitor, type Placed } from "../helpers"
import { renderEmail } from "../../supabase/functions/_shared/emails/templates.ts"

beforeEach(cancelTestOrders)
afterAll(cancelTestOrders)

describe("an order placed without an account", () => {
  test("cannot be opened by another person's account that knows, or guesses, its number", async () => {
    const [piece] = await pieces(1)
    const guest = visitor()
    const email = `guest-order-${crypto.randomUUID().slice(0, 10)}@example.test`
    const placed = must(await placeOrder(guest, email, [{ variant_id: piece.id, quantity: 1 }])) as Placed

    // anyone can make an account; sign-up asks for no confirmation
    const stranger = await customer("stranger")
    const opened = must(await stranger.sb.rpc("get_order", { p_order_number: placed.order_number, p_token: null })) as { email?: string; address_line1?: string } | null
    // as built: the guest's name, email, phone and street come back
    expect(opened, `a stranger's account opened ${placed.order_number}: ${opened?.email}, ${opened?.address_line1}`).toBeNull()
    expect(must(await stranger.sb.rpc("get_order", { p_order_number: placed.order_number, p_token: crypto.randomUUID() })), "with a made-up key").toBeNull()

    // counting down from a known number, as a script would
    const last = Number(placed.order_number.replace(/\D/g, ""))
    const numbers = Array.from({ length: 40 }, (_, i) => `NRD-${String(last - i).padStart(5, "0")}`)
    const guestOrders = (await sql<{ order_number: string }>("select order_number from public.orders where order_number = any($1) and user_id is null", [numbers])).length
    let got = 0
    for (const n of numbers) if (must(await stranger.sb.rpc("get_order", { p_order_number: n, p_token: null }))) got++
    expect(got, `of the last 40 order numbers, ${guestOrders} are orders without an account; the stranger opened`).toBe(0)
  })

  test("still opens with its link, and without the link only for nobody", async () => {
    const [piece] = await pieces(1)
    const guest = visitor()
    const email = `guest-link-${crypto.randomUUID().slice(0, 10)}@example.test`
    const placed = must(await placeOrder(guest, email, [{ variant_id: piece.id, quantity: 1 }], { client_key: crypto.randomUUID() })) as Placed
    const own = must(await guest.rpc("get_order", { p_order_number: placed.order_number, p_token: placed.access_token })) as Record<string, unknown>
    expect(own.email).toBe(email)
    // the keys that make or find orders are the shop's own business, not part of the page's data
    expect(Object.keys(own).filter((k) => ["client_key", "attempt_key", "access_token", "user_id", "discount_code_id", "stripe_payment_intent"].includes(k))).toEqual([])
    expect(must(await guest.rpc("get_order", { p_order_number: placed.order_number, p_token: null }))).toBeNull()
  })
})

describe("an order placed with an account", () => {
  test("opens for that account without a link, and for no other account", async () => {
    const [piece] = await pieces(1)
    const a = await customer("order-owner")
    const b = await customer("order-other")
    const placed = must(await placeOrder(a.sb, a.email, [{ variant_id: piece.id, quantity: 1 }])) as Placed
    expect(must(await a.sb.rpc("get_order", { p_order_number: placed.order_number, p_token: null }))).not.toBeNull()
    expect(must(await b.sb.rpc("get_order", { p_order_number: placed.order_number, p_token: null }))).toBeNull()
  })
})

describe("the link to the order in its emails", () => {
  const confirmation = async (orderNumber: string) => {
    const [{ data }] = await sql<{ data: unknown }>(
      "select e.data from public.emails e join public.orders o on o.id = e.order_id where o.order_number = $1 and e.kind = 'order_confirmation'", [orderNumber])
    return renderEmail("order_confirmation", data, { imageUrl: (p: string) => p })
  }

  test("leaves the order's key out for an order placed with an account", async () => {
    const [piece] = await pieces(1)
    const a = await customer("email-link")
    const placed = must(await placeOrder(a.sb, a.email, [{ variant_id: piece.id, quantity: 1 }])) as Placed
    const email = await confirmation(placed.order_number)
    expect(email.text).toContain(`/order/${placed.order_number}`)
    // as built: ?token=<the order's key>; opened on a shared device, it stays in that browser's history
    expect(email.text).not.toContain(placed.access_token)
    expect(email.html).not.toContain(placed.access_token)
  })

  test("keeps it for an order placed without an account: it is the guest's way back", async () => {
    const [piece] = await pieces(1)
    const placed = must(await placeOrder(visitor(), `email-link-guest-${crypto.randomUUID().slice(0, 10)}@example.test`, [{ variant_id: piece.id, quantity: 1 }])) as Placed
    const email = await confirmation(placed.order_number)
    expect(email.text).toContain(`/order/${placed.order_number}?token=${placed.access_token}`)
  })
})
