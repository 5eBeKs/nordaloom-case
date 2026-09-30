// Example data for looking at each email before any real order exists.
import type { EmailKind, OrderData, ResetData, WelcomeData } from "./templates.ts"

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

export function sampleData(kind: EmailKind, siteUrl: string, contactEmail: string, welcomeCode: WelcomeData["code"]): unknown {
  if (kind === "password_reset") {
    return { email: "anna@example.com", first_name: "Anna", link: null, expires_minutes: 60, site_url: siteUrl, contact_email: contactEmail } satisfies ResetData
  }
  if (kind === "newsletter_welcome") {
    return { email: "anna@example.com", site_url: siteUrl, contact_email: contactEmail, code: welcomeCode } satisfies WelcomeData
  }
  const order: OrderData = {
    order_number: "NRD-10001",
    access_token: "example",
    email: "anna@example.com",
    full_name: "Anna Kalniņa",
    first_name: "Anna",
    status: kind === "order_cancelled" || kind === "payment_returned" ? "cancelled" : "awaiting_payment",
    cancel_reason: kind === "order_cancelled" ? "not_paid" : kind === "payment_returned" ? "by_shop" : null,
    ...(kind === "payment_returned" ? { payment_method: "card" as const, card_brand: "visa", card_last4: "4242", refunded_cents: 18720 } : {}),
    items: [
      { name: "Kāpa Crewneck", colour: "Chestnut", size: "M", quantity: 1, image: "products/sweater-07.webp", unit_price_cents: 15900, line_total_cents: 15900 },
      { name: "Priede Turn-Up Beanie", colour: "Caramel", size: "One size", quantity: 1, image: "products/hat-02.webp", unit_price_cents: 4900, line_total_cents: 4900 },
    ],
    subtotal_cents: 20800,
    discount_code: "WELCOME10",
    discount_cents: 2080,
    shipping_label: "Omniva parcel locker",
    shipping_cents: 0,
    total_cents: 18720,
    vat_cents: 3249,
    payment_reference: "NRD-10001",
    payment_due_at: inDays(kind === "payment_reminder" ? 2 : kind === "order_cancelled" ? 0 : 5),
    address_line1: "Tērbatas iela 14",
    address_line2: "",
    city: "Rīga",
    postal_code: "LV-1011",
    country: "LV",
    parcel_locker: "Rīga, Origo",
    tracking_number: "CE123456789LV",
    delivered_at: inDays(0),
    return_until: inDays(14),
    return_days: 14,
    is_account_order: true,
    bank: { recipient: "Nordaloom SIA", iban: "LV00 EXMP 0000 0000 0000 0", bic: "EXMPLV22", bank_name: "Example Bank" },
    site_url: siteUrl,
    contact_email: contactEmail,
    return_address: "Nordaloom SIA\nLiela iela 12\nKuldiga, LV-3301\nLatvia",
    return: {
      return_number: "RET-1001",
      reason: "too_small",
      details: "Lovely, but tight across the shoulders.",
      shop_note: kind === "return_refused" ? "The sweater came back worn and washed, so we can't resell it — we're sorry." : "",
      refund_cents: 14310,
      items: [{ name: "Kāpa Crewneck", colour: "Chestnut", size: "M", quantity: 1, image: "products/sweater-07.webp" }],
    },
  }
  return order
}
