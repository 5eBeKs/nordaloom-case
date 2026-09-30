// The wish list on a device that has not got the account's list yet: nothing saved elsewhere is lost.
import { expect, test } from "@playwright/test"
import { customer, must, sql } from "../helpers"
import { signIn } from "./ui"

test("pieces saved on another device stay in the account when hearts are pressed here first", async ({ page, context }) => {
  const products = await sql<{ id: string; slug: string; name: string }>("select id, slug, name from public.products where is_published order by sort_order, id limit 4")
  const [saved1, saved2, here1, here2] = products
  const c = await customer("wishes")
  must(await c.sb.from("wishlist_items").insert([{ user_id: c.id, product_id: saved1.id }, { user_id: c.id, product_id: saved2.id }]))
  const inAccount = async () => (await sql<{ product_id: string }>("select product_id from public.wishlist_items where user_id = $1", [c.id])).map((r) => r.product_id).sort()

  // a slow connection: the account's list takes a few seconds to arrive
  await page.route("**/rest/v1/wishlist_items*", async (route) => {
    if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 2500))
    await route.continue()
  })
  await signIn(page, c)
  await page.goto(`/product/${here1.slug}`)
  await page.getByRole("button", { name: `Save ${here1.name} to your wish list` }).click()
  // when the list has arrived it holds the two saved elsewhere and the one pressed here
  await expect(page.getByRole("link", { name: "Wish list, 3 pieces" })).toBeVisible({ timeout: 20_000 })

  // without a connection another heart is pressed; then the connection is back
  await page.unroute("**/rest/v1/wishlist_items*")
  await page.goto(`/product/${here2.slug}`)
  await expect(page.getByRole("link", { name: "Wish list, 3 pieces" })).toBeVisible({ timeout: 20_000 })
  await context.setOffline(true)
  await page.getByRole("button", { name: `Save ${here2.name} to your wish list` }).click()
  await context.setOffline(false)
  // after the first fix: a piece saved on the other device was deleted from the account here
  await expect.poll(inAccount, { timeout: 30_000 }).toEqual([saved1.id, saved2.id, here1.id, here2.id].sort())
})

test("pieces put in the bag on another device stay when this device syncs what it changed offline", async ({ page, context }) => {
  const variants = await sql<{ id: string }>(
    "select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.is_published and v.stock >= 8 order by coalesce(v.price_cents, p.price_cents), v.id limit 3")
  const [here, there1, there2] = variants
  const c = await customer("two-devices")
  must(await c.sb.from("cart_items").insert({ user_id: c.id, variant_id: here.id, quantity: 1 }))
  const inAccount = async () =>
    (await sql<{ variant_id: string; quantity: number }>("select variant_id, quantity from public.cart_items where user_id = $1", [c.id])).map((r) => `${r.variant_id}:${r.quantity}`).sort()

  await signIn(page, c)
  await page.goto("/cart")
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(1)
  // meanwhile, on the laptop, two more pieces go into the bag
  must(await c.sb.from("cart_items").insert([{ user_id: c.id, variant_id: there1.id, quantity: 1 }, { user_id: c.id, variant_id: there2.id, quantity: 1 }]))
  // the phone, without a connection, takes one more of its piece
  await context.setOffline(true)
  await page.getByRole("button", { name: "Increase quantity" }).click()
  await context.setOffline(false)
  // as built: the account's bag was replaced by the phone's, and the laptop's two pieces were gone
  await expect.poll(inAccount, { timeout: 30_000 }).toEqual([`${here.id}:2`, `${there1.id}:1`, `${there2.id}:1`].sort())
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(3)
})

test("signing out while the bag is syncing does not hand the bag to the next person", async ({ page, context }) => {
  const [here] = await sql<{ id: string }>(
    "select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.is_published and v.stock >= 8 order by coalesce(v.price_cents, p.price_cents), v.id limit 1")
  const c = await customer("sign-out-sync")
  must(await c.sb.from("cart_items").insert({ user_id: c.id, variant_id: here.id, quantity: 1 }))
  await signIn(page, c)
  await page.goto("/cart")
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(1)
  // offline, one more of the piece; then to the details page, still inside the app
  await context.setOffline(true)
  await page.getByRole("button", { name: "Increase quantity" }).click()
  await page.getByRole("banner").getByRole("link", { name: "My account" }).click()
  await page.getByRole("link", { name: "Your details" }).click()
  // back online, the bag's last read on the way back is slow; the customer signs out meanwhile
  await page.route("**/rest/v1/cart_items*", async (route) => {
    if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 3000))
    await route.continue()
  })
  await context.setOffline(false)
  await page.waitForTimeout(700)
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.waitForTimeout(5000)
  // after the third fix: the signed-out device's bag held the customer's pieces, and the next person to sign in got them
  const guestBag = await page.evaluate(() => JSON.parse(localStorage.getItem("nordaloom.cart.v1") ?? "[]"))
  expect(guestBag, "the bag on the device after signing out").toEqual([])
  await expect(page.getByRole("button", { name: "Open bag, 0 items" })).toBeVisible()
})
