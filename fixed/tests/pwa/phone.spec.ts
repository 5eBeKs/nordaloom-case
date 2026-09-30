// The shop on a phone screen, and the things a phone needs to install it.
import { expect, test } from "@playwright/test"
import { cancelTestOrders, customer, must, pieces, placeOrder, sql, type Placed } from "../helpers"
import { guestBag, signIn } from "../browser/ui"
import { openInstalled } from "./app"

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
test.afterAll(cancelTestOrders)

test("no page scrolls sideways on a phone screen", async ({ page }) => {
  const [piece] = await pieces(1)
  const [{ slug }] = await sql<{ slug: string }>("select p.slug from public.product_variants v join public.products p on p.id = v.product_id where v.id = $1", [piece.id])
  const c = await customer("phone")
  const placed = must(await placeOrder(c.sb, c.email, [{ variant_id: piece.id, quantity: 1 }])) as Placed
  await signIn(page, c)
  await guestBag(page, [{ variantId: piece.id, quantity: 1 }])
  const wide: string[] = []
  for (const path of ["/", "/shop", `/product/${slug}`, "/cart", "/checkout", "/account", "/account/addresses", `/order/${placed.order_number}`, "/returns", "/contact"]) {
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 1) wide.push(`${path} (+${over}px)`)
  }
  expect(wide, "pages wider than the screen").toEqual([])
})

test("the phone is given what it needs to install the shop", async ({ page, baseURL }) => {
  await openInstalled(page, "/")
  const manifest = await (await page.request.get(`${baseURL}/manifest.webmanifest`)).json()
  expect(manifest).toMatchObject({ short_name: "Nordaloom", display: "standalone", scope: "/" })
  const sizes = await page.evaluate(async (icons: { src: string }[]) => {
    const out: string[] = []
    for (const icon of icons) {
      const bitmap = await createImageBitmap(await (await fetch(icon.src)).blob())
      out.push(`${bitmap.width}x${bitmap.height}`)
    }
    return out
  }, manifest.icons)
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]))
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller), "the service worker is in charge of the page").toBe(true)
})
