// What the installed shop leaves on a phone after the customer signs out.
import { expect, test } from "@playwright/test"
import { cancelTestOrders, customer, must, pieces, URL_ } from "../helpers"
import { fillCheckout, placeButton, signIn } from "../browser/ui"
import { openInstalled } from "./app"

test.beforeEach(cancelTestOrders)
test.afterAll(cancelTestOrders)

test("after signing out, nothing of the customer's is left on the device", async ({ page, baseURL }) => {
  const [piece] = await pieces(1)
  const c = await customer("left-behind")
  must(await c.sb.from("cart_items").insert({ user_id: c.id, variant_id: piece.id, quantity: 1 }))
  await signIn(page, c)
  await openInstalled(page, "/checkout")
  await fillCheckout(page, { name: "Left Behind", street: "Private street 77" })
  await placeButton(page).click()
  await page.waitForURL(/\/order\//)
  const orderNumber = new URL(page.url()).pathname.split("/").pop()!
  await openInstalled(page, "/account")
  await expect(page.getByText(orderNumber).first()).toBeVisible()
  // what the app saves for offline use is written a moment later
  await page.waitForTimeout(2500)
  await page.goto("/account/details")
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByText("You're signed out.")).toBeVisible()
  await page.waitForTimeout(2500)

  const left = await page.evaluate(async () => {
    const storage = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? ""]))
    const cached: string[] = []
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) cached.push(req.url)
    const databases = "databases" in indexedDB ? (await indexedDB.databases()).map((d) => d.name) : []
    return { storage, session: Object.keys(sessionStorage), cached, databases }
  })

  // Saved files: the app's own files and public product photos, nothing fetched for a person.
  const foreign = left.cached.filter((u) => !u.startsWith(baseURL!) && !u.startsWith(`${URL_}/storage/v1/object/public/`))
  expect(foreign, "saved files that are neither the app nor public photos").toEqual([])
  expect(left.cached.filter((u) => /\/(rest|auth|functions)\/v1\//.test(u)), "saved answers from the shop's data").toEqual([])

  // Storage: no sign-in, none of the customer's details, no way back into the order.
  const personal = [c.email, c.id, "Private street 77", "Left Behind", orderNumber]
  const holding = Object.entries(left.storage).filter(([k, v]) => personal.some((p) => k.includes(p) || v.includes(p))).map(([k]) => k.replace(c.id, "<customer id>"))
  // as built: the order number with its access token, and a copy of the bag and wish list under the customer's id
  expect(holding, "kept on the device, holding the customer's details").toEqual([])
  expect(left.session).toEqual([])
  expect(left.databases).toEqual([])
})
