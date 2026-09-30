import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { isOnline } from "@/lib/connection"

/** EU member states — the only places we ship to. */
export const EU_COUNTRIES: { code: string; name: string }[] = [
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "EE", name: "Estonia" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
]

export const countryName = (code: string) => EU_COUNTRIES.find((c) => c.code === code)?.name ?? code

export type ShippingRate = {
  code: string
  label: string
  description: string
  price_cents: number
  countries: string[]
  needs_locker: boolean
  sort_order: number
}

export type ShopSettings = {
  free_shipping_threshold_cents: number
  payment_days: number
  return_days: number
  return_address: string
  low_stock_threshold: number
  contact_email: string
}

export function useShippingRates() {
  return useQuery({
    queryKey: ["shipping-rates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shipping_rates").select("*").order("sort_order")
      if (error) throw error
      return data as ShippingRate[]
    },
    staleTime: 5 * 60_000,
  })
}

export function useShopSettings() {
  return useQuery({
    queryKey: ["shop-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shop_settings").select("free_shipping_threshold_cents, payment_days, return_days, return_address, low_stock_threshold, contact_email").single()
      if (error) throw error
      return data as ShopSettings
    },
    staleTime: 5 * 60_000,
  })
}

export type OrderStatus = "awaiting_payment" | "paid" | "shipped" | "delivered" | "cancelled"

export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
}

export type OrderItem = {
  id: string
  variant_id: string | null
  product_slug: string
  product_name: string
  product_image: string | null
  colour: string
  size: string
  unit_price_cents: number
  quantity: number
  line_total_cents: number
}

export type Order = {
  id: string
  order_number: string
  status: OrderStatus
  email: string
  full_name: string
  phone: string
  country: string
  address_line1: string
  address_line2: string
  city: string
  postal_code: string
  shipping_code: string
  shipping_label: string
  parcel_locker: string
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  vat_cents: number
  discount_code: string | null
  discount_cents: number
  payment_reference: string
  created_at: string
  paid_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  tracking_number: string
  cancelled_at: string | null
  cancel_reason: "not_paid" | "by_shop" | null
  payment_due_at: string | null
  payment_method: PaymentMethod
  card_brand: string | null
  card_last4: string | null
  stripe_session_id: string | null
  refunded_cents: number
  /** End of the return window, once delivered. */
  return_until: string | null
  /** Placed while signed in (returns are requested from the account). */
  is_account_order: boolean
  items: OrderItem[]
  bank: { recipient: string; iban: string; bic: string; bank_name: string }
}

export type PaymentMethod = "bank_transfer" | "card"

export type CustomerDetails = {
  email: string
  full_name: string
  phone: string
  country: string
  address_line1: string
  address_line2: string
  city: string
  postal_code: string
}

export type PlaceOrderResult =
  | { ok: true; orderNumber: string; accessToken: string; alreadyPlaced: boolean }
  | { ok: false; code: string; detail?: string; unavailable?: { variant_id: string; available: number; name?: string; withdrawn?: boolean }[] }

export async function placeOrder(
  items: { variant_id: string; quantity: number }[],
  customer: CustomerDetails,
  shippingCode: string,
  parcelLocker: string,
  discountCode: string | null = null,
  paymentMethod: PaymentMethod = "bank_transfer",
  clientKey: string | null = null,
  /** The total on the button the customer pressed: the shop refuses to order at any other. */
  expectedTotal: number | null = null,
): Promise<PlaceOrderResult> {
  const { data, error } = await supabase.rpc("place_order", {
    items,
    customer,
    shipping_code: shippingCode,
    parcel_locker: parcelLocker,
    discount_code: discountCode,
    payment_method: paymentMethod,
    client_key: clientKey,
    expected_total_cents: expectedTotal,
  })
  if (error) {
    // No answer at all: the connection dropped (the order may or may not have
    // reached the shop — sending it again with the same key is safe).
    if (!isOnline() || /failed to fetch|networkerror|load failed|network request failed/i.test(error.message)) {
      return { ok: false, code: "network" }
    }
    let unavailable
    if (error.message === "out_of_stock" && error.details) {
      try {
        unavailable = JSON.parse(error.details)
      } catch {
        unavailable = undefined
      }
    }
    return { ok: false, code: error.message, detail: error.details ?? undefined, unavailable }
  }
  return { ok: true, orderNumber: data.order_number, accessToken: data.access_token, alreadyPlaced: !!data.already_placed }
}

/**
 * One key per attempt to order, kept until the order goes through, so the
 * same order can be sent again safely (see place_order's client_key).
 */
const ATTEMPT_KEY = "nordaloom.checkout.attempt"
/** An attempt older than this is treated as a new order (the shop also only matches the last day). */
const ATTEMPT_HOURS = 12

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16))

/**
 * What is kept about an attempt: its key, and, once an attempt got no answer,
 * what exactly was sent and to which email address. With those the checkout
 * can tell, before sending something different, that the earlier attempt may
 * have gone through, and ask the shop.
 */
type Attempt = { key: string; at: number; unanswered?: { print: string; email: string } }

function savedAttempt(): Attempt | null {
  try {
    const saved = JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? "null") as Attempt | null
    if (saved && Date.now() - saved.at < ATTEMPT_HOURS * 3_600_000) return saved
    // Too old to matter: nothing of it stays on the device.
    if (saved) localStorage.removeItem(ATTEMPT_KEY)
    return null
  } catch {
    return null
  }
}

/**
 * What was sent, kept only as a short fingerprint: enough to tell "the same" from "changed",
 * and nothing that can be read back (no name, address or pieces stay on the device).
 */
export function fingerprint(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, "0")
}

export function checkoutAttemptKey() {
  const saved = savedAttempt()
  if (saved) return saved.key
  const key = uuid()
  try {
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ key, at: Date.now() } satisfies Attempt))
  } catch {
    // Private mode: the key lives for this press only.
  }
  return key
}

/** The connection dropped after the order was sent: remember what was sent. */
export function markAttemptUnanswered(print: string, email: string) {
  const saved = savedAttempt()
  if (!saved) return
  try {
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ ...saved, unanswered: { print: fingerprint(print), email } } satisfies Attempt))
  } catch {
    // Ignore.
  }
}

/** The attempt that got no answer, if there is one. */
export const unansweredAttempt = () => {
  const saved = savedAttempt()
  return saved?.unanswered ? { key: saved.key, ...saved.unanswered } : null
}

export type EarlierOrder = { order_number: string; total_cents: number; payment_method: PaymentMethod }

/** Orders that an unanswered attempt did make (only for the email address it was sent with). */
export async function earlierAttemptOrders(key: string, email: string): Promise<EarlierOrder[] | null> {
  const { data, error } = await supabase.rpc("earlier_attempt", { p_key: key, p_email: email })
  return error ? null : ((data ?? []) as EarlierOrder[])
}

export function forgetCheckoutAttempt() {
  try {
    localStorage.removeItem(ATTEMPT_KEY)
  } catch {
    // Ignore.
  }
}

/**
 * Where guests can find their confirmation page again on this device. Only
 * for orders placed without an account (a signed-in customer's orders open
 * from their account), kept for a month, and forgotten when someone signs out
 * (see forgetCustomerOnDevice).
 */
const RECENT_KEY = "nordaloom.orders.v1"
const RECENT_DAYS = 30

type Remembered = Record<string, string | { token: string; at: number }>

export function rememberOrder(orderNumber: string, token: string) {
  try {
    const all = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}") as Remembered
    all[orderNumber] = { token, at: Date.now() }
    localStorage.setItem(RECENT_KEY, JSON.stringify(all))
  } catch {
    // Storage full or blocked: the link in the URL still works.
  }
}

export function rememberedToken(orderNumber: string): string | null {
  try {
    const saved = (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}") as Remembered)[orderNumber]
    if (!saved) return null
    if (typeof saved === "string") return saved
    return Date.now() - saved.at < RECENT_DAYS * 86_400_000 ? saved.token : null
  } catch {
    return null
  }
}

/**
 * Signing out: nothing of the customer's stays in this browser: the way back
 * into orders, the copies of their bag and wish list, an unfinished attempt
 * to order.
 */
export function forgetCustomerOnDevice() {
  try {
    const personal = [".cart.account.", ".cart.unsynced.", ".cart.loaded.", ".wishlist.account.", ".wishlist.unsynced.", ".wishlist.loaded."]
    for (const key of Object.keys(localStorage)) {
      if (key === RECENT_KEY || key === ATTEMPT_KEY || (key.startsWith("nordaloom") && personal.some((p) => key.includes(p)))) localStorage.removeItem(key)
    }
  } catch {
    // Storage blocked: nothing was kept either.
  }
}

export function useOrder(orderNumber: string | undefined, token: string | null) {
  return useQuery({
    queryKey: ["order", orderNumber, token],
    enabled: !!orderNumber,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_order", { p_order_number: orderNumber!, p_token: token })
      if (error) throw error
      return data as Order | null
    },
  })
}

/** Shipping cost for a basket, applying the free-shipping threshold. */
export function shippingFor(rate: ShippingRate | undefined, subtotal: number, threshold: number | undefined) {
  if (!rate) return 0
  if (threshold !== undefined && subtotal >= threshold) return 0
  return rate.price_cents
}
