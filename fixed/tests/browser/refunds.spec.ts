// The owner's Returns page: the amount typed for a refund, and the amount the page suggests.
import { expect, test, type Page } from "@playwright/test"
import { approvedReturn, cancelTestOrders, customer, deliver, must, orderRow, owner, pieces, placeOrder, sql, type Placed, type User } from "../helpers"
import { shot, signIn } from "./ui"

let o: User
test.beforeAll(async () => {
  o = await owner()
})
test.afterAll(cancelTestOrders)

const returnNumber = async (returnId: string) => (await sql<{ return_number: string }>("select return_number from public.returns where id = $1", [returnId]))[0].return_number
const row = (page: Page, number: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${number}`) }) })
const euros = (text: string) => Math.round(parseFloat(text.replace(",", ".")) * 100)

test("a refund of 500 euros typed against a small order is not accepted", async ({ page }) => {
  const [piece] = await pieces(1)
  const c = await customer("refund-page")
  const r = await approvedReturn(o, c, [{ variant_id: piece.id, quantity: 1 }])
  const number = await returnNumber(r.returnId)
  const paid = (await orderRow(r.orderNumber)).total_cents

  await signIn(page, o)
  await page.goto("/admin/returns?status=approved")
  const item = row(page, number)
  await expect(item.getByLabel("Amount refunded (€)")).toHaveValue((paid / 100).toFixed(2))
  await item.getByLabel("Amount refunded (€)").fill("500")
  await item.getByRole("button", { name: "Mark as refunded" }).click()
  // the page answers either way: a refusal, or "marked as refunded"
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible()
  await page.waitForLoadState("networkidle")
  // as built: accepted; the customer is emailed "your refund of €500 is on its way" and the reports carry it
  const after = await orderRow(r.orderNumber)
  if (after.refunded_cents > 0) {
    // for the picture: where the return went
    await page.goto("/admin/returns?status=refunded")
    await row(page, number).getByRole("button", { name: new RegExp(`^${number}`) }).click()
    await row(page, number).scrollIntoViewIfNeeded()
  }
  await shot(page, "F2-refund-of-500")
  expect(after.refunded_cents, `refunded ${(after.refunded_cents / 100).toFixed(2)} on an order of ${(paid / 100).toFixed(2)}`).toBe(0)
  await expect(page.getByText(/more than/i).first()).toBeVisible()
})

test("an order returned in two parts is not offered its delivery charge twice", async ({ page }) => {
  const [a, b] = await pieces(2)
  const c = await customer("two-parts-page")
  const placed = must(await placeOrder(c.sb, c.email, [{ variant_id: a.id, quantity: 1 }, { variant_id: b.id, quantity: 1 }])) as Placed
  const orderId = await deliver(o, placed.order_number)
  const order = await orderRow(placed.order_number)
  const lines = await sql<{ id: string }>("select id from public.order_items where order_id = $1 order by unit_price_cents, id", [orderId])
  const numbers: string[] = []
  for (const line of lines) {
    const number = must(await c.sb.rpc("request_return", { p_order_number: placed.order_number, p_items: [{ order_item_id: line.id, quantity: 1 }], p_reason: "changed_mind" })) as string
    const [{ id }] = await sql<{ id: string }>("select id from public.returns where return_number = $1", [number])
    must(await o.sb.rpc("update_return", { p_return_id: id, p_action: "approve", p_note: "check" }))
    numbers.push(number)
  }

  await signIn(page, o)
  await page.goto("/admin/returns?status=approved")
  const suggested = async (n: string) => euros(await row(page, n).getByLabel("Amount refunded (€)").inputValue())
  await expect(row(page, numbers[1]).getByLabel("Amount refunded (€)")).toBeVisible()
  const first = await suggested(numbers[0])
  const second = await suggested(numbers[1])
  // as built: each part is suggested with the 5.99 delivery on top
  expect(first + second, `suggested ${first} + ${second} on an order of ${order.total_cents}`).toBeLessThanOrEqual(order.total_cents)

  // refund the first part as suggested; the second part then completes the order and carries the delivery
  await row(page, numbers[0]).getByRole("button", { name: "Mark as refunded" }).click()
  await expect(page.getByText(`${numbers[0]} marked as refunded.`)).toBeVisible()
  await page.reload()
  await expect(row(page, numbers[1]).getByLabel("Amount refunded (€)")).toBeVisible()
  expect(first + (await suggested(numbers[1]))).toBe(order.total_cents)
})

test("an amount typed with a thousands separator is not read as a smaller one", async ({ page }) => {
  const [piece] = await pieces(1)
  const c = await customer("refund-typed")
  const r = await approvedReturn(o, c, [{ variant_id: piece.id, quantity: 1 }])
  const number = await returnNumber(r.returnId)

  await signIn(page, o)
  await page.goto("/admin/returns?status=approved")
  const item = row(page, number)
  await item.getByLabel("Amount refunded (€)").fill("1.234,56")
  await item.getByRole("button", { name: "Mark as refunded" }).click()
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible()
  await page.waitForLoadState("networkidle")
  // as built: recorded as a refund of 1.23, with no warning
  const [ret] = await sql<{ status: string; refund_cents: number | null }>("select status, refund_cents from public.returns where id = $1", [r.returnId])
  expect([ret.status, ret.refund_cents], "the return after typing 1.234,56").toEqual(["approved", null])
  await expect(page.getByText(/plain number/i)).toBeVisible()
})
