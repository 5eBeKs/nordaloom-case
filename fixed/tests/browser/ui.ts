// What a person does in the shop, for the browser checks.
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page } from "@playwright/test"
import type { User } from "../helpers"

/** Pictures of the screen for the report: only kept when SHOTS_DIR is set (one folder before the fix, one after). */
export async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

export async function signIn(page: Page, user: Pick<User, "email" | "password">) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL((u) => !u.pathname.startsWith("/login"))
}

/** A guest's bag, as the shop keeps it on the device. */
export async function guestBag(page: Page, items: { variantId: string; quantity: number }[]) {
  if (page.url() === "about:blank") await page.goto("/")
  await page.evaluate((lines) => localStorage.setItem("nordaloom.cart.v1", JSON.stringify(lines)), items)
}

export interface Details { email?: string; name?: string; street: string }
/** Fills the checkout form; delivery by courier in Latvia (5.99). */
export async function fillCheckout(page: Page, d: Details) {
  await expect(page.getByRole("button", { name: /^Place order/ })).toBeVisible()
  if (d.email) await page.getByLabel("Email").fill(d.email)
  if (d.name) await page.getByLabel("Full name").fill(d.name)
  await page.getByLabel("Phone").fill("+371 20000000")
  await page.getByLabel("Street address").fill(d.street)
  await page.getByLabel("City").fill("Riga")
  await page.getByLabel("Postal code").fill("LV-1010")
  await page.getByRole("radio", { name: /^Courier/ }).check()
}

export const placeButton = (page: Page) => page.getByRole("button", { name: /^Place order/ })

/** The amount on the "Place order" button, in cents. */
export async function amountOnButton(page: Page) {
  const text = await placeButton(page).innerText()
  return Math.round(parseFloat(text.replace(/[^0-9.]/g, "")) * 100)
}
