// What stays on a shared device after a customer signs out, and what the owner sees about a customer.
import { expect, test } from "@playwright/test"
import { approvedReturn, cancelTestOrders, customer, must, orderRow, owner, pieces, type User } from "../helpers"
import { fillCheckout, placeButton, signIn } from "./ui"

let o: User
test.beforeAll(async () => {
  o = await owner()
})
test.beforeEach(cancelTestOrders)
test.afterAll(cancelTestOrders)

test("after signing out, the device no longer opens the customer's order", async ({ page }) => {
  const [piece] = await pieces(1)
  const c = await customer("shared-device")
  must(await c.sb.from("cart_items").insert({ user_id: c.id, variant_id: piece.id, quantity: 1 }))
  await signIn(page, c)
  await page.goto("/checkout")
  await fillCheckout(page, { name: "Shared Device", street: "Private street 77" })
  await placeButton(page).click()
  await page.waitForURL(/\/order\//)
  const orderNumber = new URL(page.url()).pathname.split("/").pop()!
  await expect(page.getByText("Private street 77")).toBeVisible()

  await page.goto("/account/details")
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByText("You're signed out.")).toBeVisible()
  // at once, not a couple of seconds later: what the app had saved about this person is gone
  const kept = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("nordaloom.saved.v1") ?? "{}")
    return ((saved.clientState?.queries ?? []) as { queryKey: unknown[] }[]).map((q) => String(q.queryKey[0]))
  })
  const personal = ["profile", "my-orders", "order", "order-returns", "addresses", "my-reviewables", "cart-variants"]
  expect(kept.filter((k) => personal.includes(k)), "saved answers still on the device").toEqual([])
  // ... and they do not come back a few seconds later
  await page.waitForTimeout(3500)
  const later = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("nordaloom.saved.v1") ?? "{}")
    return ((saved.clientState?.queries ?? []) as { queryKey: unknown[] }[]).map((q) => String(q.queryKey[0]))
  })
  expect(later.filter((k) => personal.includes(k)), "saved answers back on the device after a few seconds").toEqual([])

  // the next person on this device opens the address of that order
  await page.goto(`/order/${orderNumber}`)
  await page.waitForLoadState("networkidle")
  // as built: the order page opens with the first customer's name, street, email and phone
  await expect(page.getByText("Private street 77"), "the signed-out customer's address is shown to the next person").toHaveCount(0)
  await expect(page.getByText(c.email)).toHaveCount(0)

  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => /orders|\.account\.|unsynced|attempt/.test(k)))
  expect(left, "kept on the device after signing out").toEqual([])
})

test("the customer page shows what was refunded, and does not count it as spent", async ({ page }) => {
  const [piece] = await pieces(1)
  const c = await customer("refunded-customer")
  const r = await approvedReturn(o, c, [{ variant_id: piece.id, quantity: 1 }])
  const paid = (await orderRow(r.orderNumber)).total_cents
  must(await o.sb.rpc("update_return", { p_return_id: r.returnId, p_action: "refund", p_refund_cents: paid, p_restock: false }))

  await signIn(page, o)
  await page.goto(`/admin/customers/${encodeURIComponent(c.email)}`)
  // the figures at the top of the page: a label, and the number under it
  const figure = (label: string) => page.getByText(label, { exact: true }).first().locator("xpath=following-sibling::p[1]")
  // as built: "Spent €29.99" for a customer who got every cent back
  await expect(figure("Spent")).toHaveText("€0")
  await expect(figure("Refunded")).toHaveText(`€${(paid / 100).toFixed(2).replace(/\.00$/, "")}`)
})

test("an emailed order link still opens when someone else is signed in on the device", async ({ page }) => {
  const [piece] = await pieces(1)
  const a = await customer("link-owner")
  const b = await customer("link-other")
  const { data } = await a.sb.rpc("place_order", {
    items: [{ variant_id: piece.id, quantity: 1 }],
    customer: { email: a.email, full_name: "Link Owner", phone: "+371 20000000", country: "LV", address_line1: "Owner street 5", address_line2: "", city: "Riga", postal_code: "LV-1010" },
    shipping_code: "courier_lv", parcel_locker: "",
  })
  await signIn(page, b)
  await page.goto(`/order/${data.order_number}?token=${data.access_token}`)
  await expect(page.getByText("Owner street 5")).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1000)
  // after the first fix: the key was taken out of the address, and the page turned into "We couldn't open this order"
  await expect(page.getByText("Owner street 5")).toBeVisible()
  expect(page.url()).toContain("token=")
})
