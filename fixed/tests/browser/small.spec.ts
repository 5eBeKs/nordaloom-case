// Two smaller things a customer meets: what a return will bring back, and a piece the shop stops selling.
import { expect, test } from "@playwright/test"
import { cancelTestOrders, customer, deliver, must, owner, pieces, placeOrder, sql, type Placed } from "../helpers"
import { fillCheckout, guestBag, placeButton, signIn } from "./ui"

test.beforeEach(cancelTestOrders)
test.afterAll(cancelTestOrders)

const euro = (cents: number) => `€${(cents / 100).toFixed(2).replace(/\.00$/, "")}`

test("the return form shows what the customer paid for the pieces, after their discount", async ({ page }) => {
  const o = await owner()
  const [piece] = await pieces(1)
  const c = await customer("return-form")
  const code = `CHK${crypto.randomUUID().slice(0, 6).toUpperCase()}`
  must(await o.sb.from("discount_codes").insert({ code, kind: "percent", value: 15, note: "check" }))
  try {
    const placed = must(await placeOrder(c.sb, c.email, [{ variant_id: piece.id, quantity: 1 }], { discount_code: code })) as Placed
    await deliver(o, placed.order_number)
    await signIn(page, c)
    await page.goto(`/account/orders/${placed.order_number}/return`)
    await page.getByRole("checkbox").first().check()
    const amount = page.getByText(/^(You paid for these pieces|Value of pieces)$/).locator("xpath=following-sibling::span[1]")
    // as built: the list price, which is more than will come back
    await expect(amount).toHaveText(euro(piece.price - Math.round(piece.price * 0.15)))
  } finally {
    await o.sb.from("discount_codes").update({ is_active: false }).eq("code", code)
  }
})

test("a piece the shop stops selling leaves the bag with an explanation", async ({ page }) => {
  const [piece] = await pieces(1)
  const [{ product_id, name }] = await sql<{ product_id: string; name: string }>(
    "select v.product_id, p.name from public.product_variants v join public.products p on p.id = v.product_id where v.id = $1", [piece.id])
  await guestBag(page, [{ variantId: piece.id, quantity: 1 }])
  await page.goto("/checkout")
  await fillCheckout(page, { email: `withdrawn-${crypto.randomUUID().slice(0, 8)}@example.test`, name: "Withdrawn Piece", street: "First street 1" })
  try {
    // the owner switches off "Show in the shop"
    await sql("update public.products set is_published = false where id = $1", [product_id])
    // the customer presses the button (unless the open page has already emptied the bag by itself)
    await placeButton(page).click({ timeout: 5000 }).catch(() => undefined)
    // as built: the checkout turns into "Your bag is empty" and nothing says why
    await expect(page.getByText(new RegExp(`${name}.*no longer sold`)).first()).toBeVisible({ timeout: 20_000 })
  } finally {
    await sql("update public.products set is_published = true where id = $1", [product_id])
  }
  await expect(placeButton(page)).toHaveCount(0)
})
