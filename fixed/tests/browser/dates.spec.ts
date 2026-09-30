// Dates and deadlines are the shop's (Latvian time), whatever the clock of the device that shows them.
import { expect, test } from "@playwright/test"
import { cancelTestOrders, customer, must, owner, pieces, placeOrder, sql, type Placed } from "../helpers"
import { signIn } from "./ui"

test.afterAll(cancelTestOrders)

// 23:30 in Latvia in summer, 22:30 in winter: late evening on that day there, already the next day in Tokyo.
const now = new Date()
const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3, 20, 30))
const inLatvia = (at: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Riga", ...options }).format(at)

test.describe("on a device set to Tokyo time", () => {
  test.use({ timezoneId: "Asia/Tokyo" })

  test("the customer reads the same payment deadline as in the shop's email", async ({ page }) => {
    const [piece] = await pieces(1)
    const c = await customer("tokyo")
    const placed = must(await placeOrder(c.sb, c.email, [{ variant_id: piece.id, quantity: 1 }])) as Placed
    await sql("update public.orders set payment_due_at = $2 where order_number = $1", [placed.order_number, due.toISOString()])
    await page.goto(`/order/${placed.order_number}?token=${placed.access_token}`)
    const line = page.getByText(/Please pay by/)
    await expect(line).toBeVisible()
    // as built: one day later than the day the order cancels itself
    await expect(line).toContainText(inLatvia(due, { day: "numeric", month: "long", year: "numeric" }))
  })

  test("the owner reads order times in the shop's time", async ({ page }) => {
    const [piece] = await pieces(1)
    const c = await customer("tokyo-admin")
    const placed = must(await placeOrder(c.sb, c.email, [{ variant_id: piece.id, quantity: 1 }])) as Placed
    const at = new Date(due.getTime() - 5 * 86_400_000)
    await sql("update public.orders set created_at = $2 where order_number = $1", [placed.order_number, at.toISOString()])
    await signIn(page, await owner())
    await page.goto(`/admin/orders/${placed.order_number}`)
    await expect(page.getByText(/^Placed /)).toHaveText(`Placed ${inLatvia(at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`)
  })
})
