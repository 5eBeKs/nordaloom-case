// The installed shop without a connection: it opens, the bag is right, and an order is not sent or lost.
import { expect, test } from "@playwright/test"
import { cancelTestOrders, customer, must, pieces, sql } from "../helpers"
import { fillCheckout, guestBag, placeButton, shot, signIn } from "../browser/ui"
import { goOffline, goOnline, openInstalled, shopIsOpen } from "./app"

test.beforeEach(cancelTestOrders)
test.afterAll(cancelTestOrders)

const mail = (tag: string) => `${tag}-${crypto.randomUUID().slice(0, 10)}@example.test`
const priceOf = (cents: number) => `€${(cents / 100).toFixed(2).replace(/\.00$/, "")}`

test("the shop opens without a connection after it has been opened once", async ({ page, context }) => {
  await openInstalled(page, "/")
  await openInstalled(page, "/shop")
  await goOffline(context)
  await page.reload()
  await page.waitForTimeout(3000)
  await shot(page, "F4-shop-without-a-connection")
  // as built, on a host that answers with "Vary: Origin": an empty page, no message
  await expect(shopIsOpen(page), "the saved shop is on screen").toBeVisible()
  await expect(page.getByText(/You're offline/).first()).toBeVisible()
  // a page never opened before is the same app
  await page.goto("/about")
  await expect(shopIsOpen(page)).toBeVisible()
})

test("without a connection nothing is sent; back online the order goes through once", async ({ page, context }) => {
  const [piece] = await pieces(1)
  const email = mail("offline-order")
  await openInstalled(page, "/")
  await guestBag(page, [{ variantId: piece.id, quantity: 1 }])
  await page.goto("/checkout")
  await fillCheckout(page, { email, name: "Offline Order", street: "First street 1" })
  await goOffline(context)
  await placeButton(page).click()
  await expect(page.getByText(/Nothing has been sent or charged/)).toBeVisible()
  expect(await sql("select 1 from public.orders where email = $1", [email])).toHaveLength(0)
  await goOnline(context)
  await placeButton(page).click()
  await page.waitForURL(/\/order\//)
  expect(await sql("select 1 from public.orders where email = $1", [email])).toHaveLength(1)
})

test("a piece added without a connection is listed and priced in the bag", async ({ page, context }) => {
  const [a, b] = await pieces(2)
  const [{ slug, colour, size }] = await sql<{ slug: string; colour: string; size: string }>(
    "select p.slug, v.colour, v.size from public.product_variants v join public.products p on p.id = v.product_id where v.id = $1", [b.id])
  await openInstalled(page, "/")
  await guestBag(page, [{ variantId: a.id, quantity: 1 }])
  await openInstalled(page, `/product/${slug}?colour=${encodeURIComponent(colour)}`)
  await goOffline(context)
  await page.getByRole("button", { name: colour, exact: true }).click()
  if (size !== "One size") await page.getByRole("button", { name: size, exact: true }).click()
  await page.getByRole("button", { name: /add to bag/i }).click()
  // from the bag panel to the bag page, inside the running app (no reload)
  await page.getByRole("link", { name: "View bag & checkout" }).click()
  await expect(page.getByRole("heading", { name: "Your bag", level: 1 })).toBeVisible()
  // as built: "2 pieces", one line, and the subtotal of one
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(2)
  await expect(page.getByText("Subtotal (2 pieces)")).toBeVisible()
  await expect(page.getByRole("definition").first()).toHaveText(priceOf(a.price + b.price))
})

test("the bag is whole after the app is started without a connection", async ({ page, context }) => {
  const [a, b] = await pieces(2)
  await openInstalled(page, "/")
  await guestBag(page, [{ variantId: a.id, quantity: 1 }, { variantId: b.id, quantity: 1 }])
  await openInstalled(page, "/cart")
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(2)
  // one piece is taken out; the app is closed and started again with no connection
  await page.getByRole("main").getByRole("listitem").first().getByRole("button", { name: "Remove" }).click()
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(1)
  await goOffline(context)
  await page.reload()
  // as built: "Loading your bag…" and a total of €0 (or an empty page)
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(1)
  await expect(page.getByText("Subtotal (1 piece)")).toBeVisible()
  await expect(page.getByRole("definition").first()).not.toHaveText("€0")
})

test("signed in: a piece added straight after starting without a connection stays in the bag", async ({ page, context }) => {
  const [a, b] = await pieces(2)
  const [{ slug, colour, size }] = await sql<{ slug: string; colour: string; size: string }>(
    "select p.slug, v.colour, v.size from public.product_variants v join public.products p on p.id = v.product_id where v.id = $1", [b.id])
  const c = await customer("offline-bag")
  must(await c.sb.from("cart_items").insert({ user_id: c.id, variant_id: a.id, quantity: 1 }))
  await signIn(page, c)
  await openInstalled(page, "/cart")
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(1)
  await openInstalled(page, `/product/${slug}?colour=${encodeURIComponent(colour)}`)
  await goOffline(context)
  await page.reload()
  await page.getByRole("button", { name: colour, exact: true }).click()
  if (size !== "One size") await page.getByRole("button", { name: size, exact: true }).click()
  await page.getByRole("button", { name: /add to bag/i }).click()
  // as built: about seven seconds later the saved bag overwrites the screen and the new piece is gone
  await page.waitForTimeout(12_000)
  const kept = await page.evaluate((id) => JSON.parse(localStorage.getItem(`nordaloom.cart.account.${id}`) ?? "[]").map((l: { variantId: string }) => l.variantId), c.id)
  expect(kept.sort(), "the bag kept on the device").toEqual([a.id, b.id].sort())
  // the bag panel, which opened when the piece was added, still lists both
  await expect(page.getByRole("dialog", { name: "Your bag" }).getByRole("listitem")).toHaveCount(2)
  // back online the account gets it
  await goOnline(context)
  await expect.poll(async () => (await sql("select 1 from public.cart_items where user_id = $1", [c.id])).length, { timeout: 30_000 }).toBe(2)
})
