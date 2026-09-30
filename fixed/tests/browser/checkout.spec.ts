// The checkout in a browser: an order sent again after a lost answer, and a price that moves while it is open.
import { expect, test } from "@playwright/test"
import { cancelTestOrders, customer, must, pieces, sql } from "../helpers"
import { amountOnButton, fillCheckout, guestBag, placeButton, shot, signIn } from "./ui"

test.beforeEach(cancelTestOrders)

const mail = (tag: string) => `${tag}-${crypto.randomUUID().slice(0, 10)}@example.test`
const ordersOf = (email: string) =>
  sql<{ order_number: string; total_cents: number; pieces: number }>(
    "select o.order_number, o.total_cents, (select sum(quantity)::int from public.order_items i where i.order_id = o.id) as pieces from public.orders o where o.email = $1 order by o.created_at", [email])

test("after a lost answer, a different bag and a different person get their own order", async ({ page }) => {
  const [a, b] = await pieces(2)
  const one = mail("first-customer")
  const two = mail("second-customer")

  // The first customer orders; the order reaches the shop, the answer never comes back (the connection drops).
  await guestBag(page, [{ variantId: a.id, quantity: 1 }])
  await page.goto("/checkout")
  await fillCheckout(page, { email: one, name: "First Customer", street: "First customer street 1" })
  await page.route("**/rest/v1/rpc/place_order", async (route) => {
    await route.fetch()
    await route.abort("failed")
  }, { times: 1 })
  await placeButton(page).click()
  await expect(page.getByText(/couldn't (reach|confirm)/i)).toBeVisible()
  const [first] = await ordersOf(one)
  expect(first, "the first customer's order is in the shop").toBeTruthy()

  // Later on the same device: another bag, another person.
  await guestBag(page, [{ variantId: b.id, quantity: 2 }])
  await page.goto("/checkout")
  await fillCheckout(page, { email: two, name: "Second Customer", street: "Second customer street 2" })
  const shown = await amountOnButton(page)
  await placeButton(page).click()
  // the device's earlier attempt went through: the second customer is told that much, and nothing about it
  await expect(page.getByText(/An earlier attempt from this device did reach us/)).toBeVisible()
  await expect(page.getByText("First customer street 1")).toHaveCount(0)
  await placeButton(page).click()
  await page.waitForURL(/\/order\//)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await page.waitForLoadState("networkidle")
  await shot(page, "F1-order-after-lost-answer")

  // as built: the first customer's order, name, street, phone and email are shown, and the second bag is emptied unordered
  await expect(page.getByText("First customer street 1"), "the first customer's address is on the second customer's screen").toHaveCount(0)
  expect(page.url()).not.toContain(first.order_number)
  const theirs = await ordersOf(two)
  expect(theirs.map((o) => [o.pieces, o.total_cents]), "the second customer's order").toEqual([[2, shown]])
})

test("when the answer is lost, the message says the order may have gone through", async ({ page }) => {
  const [a] = await pieces(1)
  await guestBag(page, [{ variantId: a.id, quantity: 1 }])
  await page.goto("/checkout")
  await fillCheckout(page, { email: mail("lost"), name: "Lost Answer", street: "First street 1" })
  await page.route("**/rest/v1/rpc/place_order", async (route) => {
    await route.fetch()
    await route.abort("failed")
  }, { times: 1 })
  await placeButton(page).click()
  // as built: "We couldn't reach the shop", although the order was made and its pieces are held
  await expect(page.getByText(/may (already )?have (reached|gone)/i)).toBeVisible()
})

test("a price that went up while the checkout was open is not charged without asking", async ({ page }) => {
  const [piece] = await pieces(1)
  const email = mail("price")
  const [{ price_cents: before }] = await sql<{ price_cents: number | null }>("select price_cents from public.product_variants where id = $1", [piece.id])
  // the phone is asleep or the connection is poor: live price updates are not arriving
  await page.routeWebSocket(/realtime/, () => {})
  await guestBag(page, [{ variantId: piece.id, quantity: 1 }])
  await page.goto("/checkout")
  await fillCheckout(page, { email, name: "Price Watcher", street: "First street 1" })
  const shown = await amountOnButton(page)
  try {
    // the owner raises the price by 4 euros
    await sql("update public.product_variants set price_cents = $2 where id = $1", [piece.id, piece.price + 400])
    await placeButton(page).click()
    // as built: an order for 4 euros more than the button said, first seen on the confirmation page
    await expect(page.getByText(/price.*changed|changed.*price/i).first()).toBeVisible()
    expect(await ordersOf(email), "no order at a total the customer did not see").toEqual([])
    await expect.poll(() => amountOnButton(page)).toBe(shown + 400)
    await placeButton(page).click()
    await page.waitForURL(/\/order\//)
    expect((await ordersOf(email)).map((o) => o.total_cents)).toEqual([shown + 400])
  } finally {
    await sql("update public.product_variants set price_cents = $2 where id = $1", [piece.id, before])
  }
})

/** The order reaches the shop; the answer is lost on the way back. */
const loseTheAnswer = (page: import("@playwright/test").Page) =>
  page.route("**/rest/v1/rpc/place_order", async (route) => {
    await route.fetch()
    await route.abort("failed")
  }, { times: 1 })

test("after a lost answer, a corrected address does not quietly make a second order", async ({ page }) => {
  const [piece] = await pieces(1)
  const email = mail("corrected")
  await guestBag(page, [{ variantId: piece.id, quantity: 1 }])
  await page.goto("/checkout")
  await fillCheckout(page, { email, name: "Corrected Street", street: "Brivibas iela 1" })
  await loseTheAnswer(page)
  await placeButton(page).click()
  await expect(page.getByText(/couldn't confirm/i)).toBeVisible()
  const [first] = await ordersOf(email)

  // the connection is back; the customer fixes the street and presses again
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await page.getByLabel("Street address").fill("Brivibas iela 1-2")
  await placeButton(page).click()
  // after the first fix: a second order for the same socks, and the first one never shown
  await expect(page.getByText(new RegExp(`Your earlier attempt did reach us.*${first.order_number}`))).toBeVisible()
  expect(await ordersOf(email), "orders so far").toHaveLength(1)

  // the customer is told it would be another order; pressing again is their decision
  await placeButton(page).click()
  await page.waitForURL(/\/order\//)
  expect(await ordersOf(email)).toHaveLength(2)
})

test("signed in, after a lost answer and a reload, the customer is told the order went through", async ({ page }) => {
  const [piece] = await pieces(1)
  const c = await customer("lost-reload")
  must(await c.sb.from("cart_items").insert({ user_id: c.id, variant_id: piece.id, quantity: 1 }))
  await signIn(page, c)
  await page.goto("/checkout")
  await fillCheckout(page, { name: "Lost Reload", street: "First street 1" })
  await loseTheAnswer(page)
  await placeButton(page).click()
  await expect(page.getByText(/couldn't confirm/i)).toBeVisible()
  const [order] = await ordersOf(c.email)
  await page.reload()
  // after the first fix: "Your bag is empty", and nothing about the order that was made
  await expect(page.getByText(new RegExp(`Your order did reach us.*${order.order_number}`))).toBeVisible()
})

test("a delivery price changed while the checkout is open does not lock the customer out", async ({ page }) => {
  const [piece] = await pieces(1)
  const email = mail("delivery")
  await guestBag(page, [{ variantId: piece.id, quantity: 1 }])
  await page.goto("/checkout")
  await fillCheckout(page, { email, name: "Delivery Price", street: "First street 1" })
  const shown = await amountOnButton(page)
  try {
    await sql("update public.shipping_rates set price_cents = price_cents + 100 where code = 'courier_lv'")
    await placeButton(page).click()
    await expect(page.getByText(/price changed/i).first()).toBeVisible()
    // after the first fix: the same message on every press for up to five minutes, the button never changing
    await expect.poll(() => amountOnButton(page)).toBe(shown + 100)
    await placeButton(page).click()
    await page.waitForURL(/\/order\//)
    expect((await ordersOf(email)).map((o) => o.total_cents)).toEqual([shown + 100])
  } finally {
    await sql("update public.shipping_rates set price_cents = price_cents - 100 where code = 'courier_lv'")
  }
})

test("after a lost answer, a corrected email address does not quietly make a second order either", async ({ page }) => {
  const [piece] = await pieces(1)
  const mistyped = mail("mistyped")
  const corrected = mail("corrected-email")
  await guestBag(page, [{ variantId: piece.id, quantity: 1 }])
  await page.goto("/checkout")
  await fillCheckout(page, { email: mistyped, name: "Corrected Email", street: "Brivibas iela 1" })
  await loseTheAnswer(page)
  await placeButton(page).click()
  await expect(page.getByText(/couldn't confirm/i)).toBeVisible()
  const [first] = await ordersOf(mistyped)

  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await page.getByLabel("Email").fill(corrected)
  // the phone written another way, too: nothing on the page may assume it is the same person
  await page.getByLabel("Phone").fill("20000000")
  await placeButton(page).click()
  // after the second fix: straight to a second order, the first left under the mistyped address
  await expect(page.getByText(/An earlier attempt from this device did reach us, under another email address/)).toBeVisible()
  // someone else's order is never named to a different address
  await expect(page.getByText(first.order_number)).toHaveCount(0)
  expect(await ordersOf(corrected)).toHaveLength(0)
  await placeButton(page).click()
  await page.waitForURL(/\/order\//)
  expect(await ordersOf(corrected)).toHaveLength(1)
})
