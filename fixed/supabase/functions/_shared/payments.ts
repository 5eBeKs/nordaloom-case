// Card payments through Stripe Checkout (Stripe's own payment page). Plain
// fetch against Stripe's API, so it runs in the edge runtime and in local tests.
//
// Settings (supabase/functions/.env):
//   STRIPE_SECRET_KEY      sk_test_… (test mode) or sk_live_…
//   STRIPE_WEBHOOK_SECRET  whsec_… (optional locally; see README)

import type { Env } from "./server.ts"

export type PayEnv = Env & {
  stripeKey?: string
  webhookSecret?: string
  /** Only for tests against a stand-in; normally Stripe itself. */
  stripeApi: string
}

export const payEnvFrom = (env: Env, get: (name: string) => string | undefined): PayEnv => ({
  ...env,
  stripeKey: get("STRIPE_SECRET_KEY") || undefined,
  webhookSecret: get("STRIPE_WEBHOOK_SECRET") || undefined,
  stripeApi: get("STRIPE_API_BASE") || "https://api.stripe.com",
})

/** How long the customer has on Stripe's page (Stripe's minimum is 30 minutes). */
const SESSION_MINUTES = 31

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export class PaymentError extends Error {
  status: number
  /** Stripe's own answer code, when the error is Stripe's. */
  stripeStatus?: number
  constructor(message: string, status = 400, stripeStatus?: number) {
    super(message)
    this.status = status
    this.stripeStatus = stripeStatus
  }
}

/** Stripe wants form encoding with nested keys: line_items[0][price_data][currency]=eur */
function form(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (typeof v === "object") form(v as Record<string, unknown>, key, out)
    else out.append(key, String(v))
  }
  return out
}

async function stripe(env: PayEnv, method: "GET" | "POST", path: string, params?: Record<string, unknown>, idempotencyKey?: string) {
  if (!env.stripeKey) throw new PaymentError("Card payments aren't set up (STRIPE_SECRET_KEY is missing).", 503)
  const query = method === "GET" && params ? `?${form(params)}` : ""
  const res = await fetch(`${env.stripeApi}/v1/${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: method === "POST" && params ? form(params) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new PaymentError(`Stripe: ${body.error?.message ?? res.status}`, 502, res.status)
  return body
}

async function db(env: Env, path: string, init: RequestInit = {}) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`Database request ${path} failed: ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
const rpc = (env: Env, fn: string, args: Record<string, unknown>) => db(env, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) })

type OrderRow = {
  id: string
  order_number: string
  access_token: string
  user_id: string | null
  email: string
  status: string
  payment_method: string
  stripe_session_id: string | null
  stripe_payment_intent: string | null
  total_cents: number
  refunded_cents: number
  subtotal_cents: number
  discount_cents: number
  discount_code: string | null
  shipping_cents: number
  shipping_label: string
  order_items: { product_name: string; colour: string; size: string; quantity: number; unit_price_cents: number }[]
}

const ORDER_FIELDS =
  "id,order_number,access_token,user_id,email,status,payment_method,stripe_session_id,stripe_payment_intent,total_cents,refunded_cents,subtotal_cents,discount_cents,discount_code,shipping_cents,shipping_label,order_items(product_name,colour,size,quantity,unit_price_cents)"

async function orderById(env: Env, id: string): Promise<OrderRow | null> {
  return (await db(env, `orders?id=eq.${encodeURIComponent(id)}&select=${ORDER_FIELDS}`))[0] ?? null
}

/** Who is calling: the signed-in user (from their token), if any. */
async function callerId(env: Env, authorization: string | null): Promise<string | null> {
  const jwt = authorization?.replace(/^Bearer\s+/i, "")
  if (!jwt || jwt.split(".").length !== 3) return null
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, { headers: { apikey: env.serviceKey, Authorization: `Bearer ${jwt}` } })
  if (!res.ok) return null
  return (await res.json()).id ?? null
}

/** The order, if the caller may act on it: its access token, or signed in as its customer. */
async function orderForCustomer(env: Env, orderNumber: unknown, token: unknown, authorization: string | null) {
  const rows: OrderRow[] = await db(env, `orders?order_number=eq.${encodeURIComponent(String(orderNumber ?? ""))}&select=${ORDER_FIELDS}`)
  const order = rows[0]
  if (!order) throw new PaymentError("not_found", 404)
  if (token && String(token) === order.access_token) return order
  const uid = await callerId(env, authorization)
  if (uid && uid === order.user_id) return order
  throw new PaymentError("not_found", 404)
}

async function requireOwner(env: Env, authorization: string | null) {
  const uid = await callerId(env, authorization)
  const rows = uid ? await db(env, `profiles?id=eq.${uid}&select=role`) : []
  if (rows[0]?.role !== "owner") throw new PaymentError("not_allowed", 403)
}

const siteUrl = async (env: Env): Promise<string> => (await db(env, "shop_settings?select=site_url&limit=1"))[0].site_url

// ---------------------------------------------------------------------------
// Starting a payment
// ---------------------------------------------------------------------------

/**
 * Closes the order's open payment page. The order is first marked as being
 * re-arranged, so Stripe's "page expired" notice for the old page can't
 * cancel it in the meantime. Returns false if it turned out to be paid, and
 * true only once the page is known to be closed: if Stripe doesn't close it
 * (or can't be asked), this fails and nothing may be built on it.
 */
async function closeOpenPage(env: PayEnv, order: OrderRow, sessionId: string) {
  await rpc(env, "set_card_session", { p_order_id: order.id, p_session_id: `replacing:${sessionId}`, p_expires_at: new Date(Date.now() + 40 * 60_000).toISOString() })
  try {
    await stripe(env, "POST", `checkout/sessions/${sessionId}/expire`)
  } catch {
    // Not closed by this call: already paid, already expired, not Stripe's at all, or Stripe didn't do it. Ask which.
    const state = await settle(env, order, sessionId)
    if (state === "paid") return false
    if (state === "open") throw new PaymentError("Stripe didn't close the payment page, so the order was left as it is. Please try again in a moment.", 502)
  }
  return true
}

function lineItems(o: OrderRow) {
  // With a discount, Stripe can't show a negative line: one line for the whole order instead.
  if (o.discount_cents > 0) {
    const pieces = o.order_items.reduce((n, i) => n + i.quantity, 0)
    return [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: o.total_cents,
          product_data: {
            name: `Nordaloom order ${o.order_number}`,
            description: `${pieces} ${pieces === 1 ? "piece" : "pieces"}, delivery, and ${o.discount_code} discount`,
          },
        },
      },
    ]
  }
  const items = o.order_items.map((i) => ({
    quantity: i.quantity,
    price_data: {
      currency: "eur",
      unit_amount: i.unit_price_cents,
      // Stripe refuses empty text, so a missing description is left out altogether.
      product_data: { name: i.product_name, description: [i.colour, i.size !== "One size" ? i.size : null].filter(Boolean).join(" · ") || undefined },
    },
  }))
  if (o.shipping_cents > 0) {
    items.push({ quantity: 1, price_data: { currency: "eur", unit_amount: o.shipping_cents, product_data: { name: `Delivery · ${o.shipping_label}`, description: undefined } } })
  }
  return items
}

/** Opens Stripe's payment page for an order and returns its address. */
async function start(env: PayEnv, order: OrderRow) {
  if (order.payment_method !== "card" || order.status !== "awaiting_payment") throw new PaymentError("not_payable", 409)
  // Only ever one open payment page per order: close the previous one first.
  const previous = order.stripe_session_id?.replace(/^replacing:/, "")
  if (previous) {
    const state = await settle(env, order, previous)
    if (state === "paid") throw new PaymentError("already_paid", 409)
    if (state === "open" && !(await closeOpenPage(env, order, previous))) throw new PaymentError("already_paid", 409)
    const again = await orderById(env, order.id)
    if (!again || again.status !== "awaiting_payment") throw new PaymentError("not_payable", 409)
  }
  const site = await siteUrl(env)
  const page = `${site}/order/${encodeURIComponent(order.order_number)}`
  // Where Stripe sends the customer back to. This address stays in the browser's history. An order that belongs
  // to an account opens by signing in, so its key stays out of it (someone else on the device could open the
  // order from the history after the customer has signed out). An order without an account has only its key to
  // open by, as in the emailed link.
  const back = order.user_id ? `${page}?` : `${page}?token=${order.access_token}&`
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60
  const session = await stripe(env, "POST", "checkout/sessions", {
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: order.email,
    client_reference_id: order.order_number,
    locale: "en",
    expires_at: expiresAt,
    line_items: lineItems(order),
    metadata: { order_id: order.id, order_number: order.order_number },
    payment_intent_data: { description: `Nordaloom order ${order.order_number}`, metadata: { order_id: order.id, order_number: order.order_number } },
    success_url: `${back}card=return`,
    cancel_url: `${back}card=cancelled`,
  })
  const ok = await rpc(env, "set_card_session", { p_order_id: order.id, p_session_id: session.id, p_expires_at: new Date(expiresAt * 1000).toISOString() })
  if (!ok) {
    await stripe(env, "POST", `checkout/sessions/${session.id}/expire`).catch(() => undefined)
    throw new PaymentError("not_payable", 409)
  }
  return { url: session.url as string }
}

// ---------------------------------------------------------------------------
// Finding out what happened
// ---------------------------------------------------------------------------

/** "gone": Stripe has no such page under the shop's key (the keys were changed), so nothing can be paid on it here. */
type SessionState = "paid" | "open" | "expired" | "cancelled_order" | "gone" | "unknown"

/** Asks Stripe about the order's payment page and brings the order up to date. */
async function settle(env: PayEnv, order: OrderRow, marker = order.stripe_session_id): Promise<SessionState> {
  if (!marker) return "unknown"
  // A page that is being replaced is still a page someone may be paying on.
  const sessionId = marker.replace(/^replacing:/, "")
  let s
  try {
    s = await stripe(env, "GET", `checkout/sessions/${sessionId}`, { expand: ["payment_intent.latest_charge"] })
  } catch (err) {
    if (err instanceof PaymentError && err.stripeStatus === 404) return "gone"
    throw err
  }
  if (s.metadata?.order_id && s.metadata.order_id !== order.id) throw new PaymentError("session_mismatch", 409)
  if (s.payment_status === "paid") {
    const pi = typeof s.payment_intent === "object" ? s.payment_intent : null
    const card = pi?.latest_charge?.payment_method_details?.card
    const piId = pi?.id ?? s.payment_intent
    const result = await rpc(env, "record_card_payment", {
      p_order_id: order.id,
      p_session_id: s.id,
      p_payment_intent: piId,
      p_amount: s.amount_total,
      p_currency: s.currency,
      p_brand: card?.brand ?? null,
      p_last4: card?.last4 ?? null,
      p_livemode: !!s.livemode,
    })
    if (result === "cancelled") {
      // Paid although the order was already cancelled: give the money straight back. If the refund fails here,
      // the next notice or check comes through this branch again (the key makes it one refund at Stripe).
      await stripe(env, "POST", "refunds", { payment_intent: piId, metadata: { order_number: order.order_number, reason: "order_cancelled" } }, `late-${piId}`)
      await rpc(env, "record_late_payment_refund", { p_order_id: order.id, p_amount: s.amount_total })
      return "cancelled_order"
    }
    // Cancelled, and the money has already gone back.
    if (result === "refunded") return "cancelled_order"
    if (result === "duplicate") {
      // The order was already paid another way: this second payment goes straight back.
      await stripe(env, "POST", "refunds", { payment_intent: piId, metadata: { order_number: order.order_number, reason: "paid_twice" } }, `twice-${piId}`)
      console.error(`Order ${order.order_number}: a second payment (${s.amount_total} ${s.currency}) was refunded`)
      return "paid"
    }
    if (result === "mismatch") console.error(`Order ${order.order_number}: paid amount ${s.amount_total} ${s.currency} doesn't match the order`)
    return "paid"
  }
  if (s.status === "expired") {
    await rpc(env, "cancel_unpaid_card_order", { p_order_id: order.id, p_session_id: s.id })
    return "expired"
  }
  return "open"
}

/**
 * A cancelled card order that still has a payment page on record and nothing returned: make sure no payment
 * got through after all. If one did, settle gives it back. If the page can still be paid, it is closed. Once it
 * is known closed and unpaid, it is taken off the record, so there is nothing more to ask.
 */
async function settleCancelled(env: PayEnv, order: OrderRow): Promise<SessionState> {
  // A page that turns out to belong to another order is not this order's page: nothing to ask about here.
  let state = await settle(env, order).catch((err) => {
    if (err instanceof PaymentError && err.message === "session_mismatch") return "gone" as const
    throw err
  })
  if (state === "open") {
    const page = order.stripe_session_id!.replace(/^replacing:/, "")
    state = await stripe(env, "POST", `checkout/sessions/${page}/expire`).then(() => "expired" as const, () => "open" as const)
  }
  if (state === "expired" || state === "gone") await rpc(env, "close_card_session", { p_order_id: order.id })
  return state
}

const needsLateCheck = (o: OrderRow) => o.payment_method === "card" && o.status === "cancelled" && !!o.stripe_session_id && o.refunded_cents === 0

/**
 * Every open card order, checked with Stripe (the database asks every two minutes), and every card order
 * cancelled in the last three days that still has a payment page on record.
 */
async function syncAll(env: PayEnv) {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const open: { id: string }[] = await db(env, "orders?payment_method=eq.card&status=eq.awaiting_payment&stripe_session_id=not.is.null&select=id&order=payment_due_at.asc&limit=50")
  const cancelled: { id: string }[] = await db(
    env,
    `orders?payment_method=eq.card&status=eq.cancelled&stripe_session_id=not.is.null&refunded_cents=eq.0&cancelled_at=gt.${encodeURIComponent(since)}&select=id&order=cancelled_at.desc&limit=50`,
  )
  const results: Record<string, number> = {}
  for (const { id } of [...open, ...cancelled]) {
    const order = await orderById(env, id)
    if (!order) continue
    const state = await (needsLateCheck(order) ? settleCancelled(env, order) : settle(env, order)).catch((e) => (console.error(e), "unknown" as const))
    results[state] = (results[state] ?? 0) + 1
  }
  return results
}

// ---------------------------------------------------------------------------
// Refunds (owner only)
// ---------------------------------------------------------------------------

async function refundReturn(env: PayEnv, returnId: string, amount: number, restock: boolean) {
  const r = (await db(env, `returns?id=eq.${encodeURIComponent(returnId)}&select=id,return_number,status,order_id`))[0]
  if (!r || r.status !== "approved") throw new PaymentError("not_refundable", 409)
  const order = await orderById(env, r.order_id)
  if (!order || order.payment_method !== "card" || !order.stripe_payment_intent) throw new PaymentError("not_a_card_order", 409)
  const left = Math.max(0, order.total_cents - order.refunded_cents)
  if (!Number.isInteger(amount) || amount < 0) throw new PaymentError("invalid_amount")
  if (amount > left) throw new PaymentError("more_than_paid")
  if (amount === 0) {
    // Closing a return without a refund: nothing goes to Stripe.
    await rpc(env, "record_card_refund", { p_return_id: r.id, p_amount: 0, p_refund_id: null, p_restock: restock })
    return { refunded: 0, refund_id: null }
  }
  const refund = await stripe(
    env,
    "POST",
    "refunds",
    { payment_intent: order.stripe_payment_intent, amount, metadata: { order_number: order.order_number, return_number: r.return_number } },
    `return-${r.id}-${amount}`,
  )
  await rpc(env, "record_card_refund", { p_return_id: r.id, p_amount: amount, p_refund_id: refund.id, p_restock: restock })
  return { refunded: amount, refund_id: refund.id }
}

/**
 * The owner cancels a card order. Not paid yet: its payment page at Stripe is closed first, and the order is
 * cancelled only once the page is known to be closed, so the customer can't pay for an order that no longer
 * exists. Paid (even a moment ago, on that page): the whole amount goes back.
 */
async function cancelOrder(env: PayEnv, orderId: string) {
  // More than once, because the customer may be doing something to the same order at the same moment.
  for (let round = 0; round < 3; round++) {
    const order = await orderById(env, orderId)
    if (!order || order.payment_method !== "card") throw new PaymentError("not_a_card_order", 409)
    if (order.status === "paid") return await cancelPaidOrder(env, order)
    // Its page had expired and the order cancelled itself: nothing was paid.
    if (order.status === "cancelled") return { refunded: order.refunded_cents, refund_id: null }
    if (order.status !== "awaiting_payment") throw new PaymentError("not_cancellable", 409)
    let marker = order.stripe_session_id
    if (marker) {
      const page = marker.replace(/^replacing:/, "")
      // Asking Stripe brings the order up to date if the page was paid or has expired meanwhile.
      const state = await settle(env, order, page)
      if (state === "paid" || state === "cancelled_order") continue
      if (state === "expired" && marker === page) continue
      if (state === "open") {
        if (!(await closeOpenPage(env, order, page))) continue
        marker = `replacing:${page}`
      }
    }
    // Only if the order still has the page that was just seen closed: the customer may have opened another meanwhile.
    if (await rpc(env, "cancel_open_card_order", { p_order_id: order.id, p_session: marker })) return { refunded: 0, refund_id: null }
  }
  throw new PaymentError("The order changed while it was being cancelled. Please try again.", 409)
}

async function cancelPaidOrder(env: PayEnv, order: OrderRow) {
  if (order.payment_method !== "card" || order.status !== "paid" || !order.stripe_payment_intent) throw new PaymentError("not_refundable", 409)
  const amount = order.total_cents - order.refunded_cents
  let refundId: string | null = null
  if (amount > 0) {
    const refund = await stripe(env, "POST", "refunds", { payment_intent: order.stripe_payment_intent, amount, metadata: { order_number: order.order_number, reason: "cancelled_by_shop" } }, `cancel-${order.id}`)
    refundId = refund.id
  }
  await rpc(env, "record_card_cancellation", { p_order_id: order.id, p_amount: amount })
  return { refunded: amount, refund_id: refundId }
}

// ---------------------------------------------------------------------------
// The card-payment function: one entry point, several actions
// ---------------------------------------------------------------------------

export async function handleCardPayment(env: PayEnv, body: Record<string, unknown>, authorization: string | null) {
  switch (body.action) {
    case "status":
      return { enabled: !!env.stripeKey, test: env.stripeKey?.startsWith("sk_test_") ?? false }
    case "start": {
      const order = await orderForCustomer(env, body.order_number, body.token, authorization)
      return await start(env, order)
    }
    case "check": {
      const order = await orderForCustomer(env, body.order_number, body.token, authorization)
      if (order.payment_method !== "card") return { status: order.status }
      // Cancelled with a payment page on record and nothing returned: make sure no payment got through after all
      // (if one did, settle gives it back).
      const late = needsLateCheck(order)
      if (order.status !== "awaiting_payment" && !late) return { status: order.status }
      const state = late ? await settleCancelled(env, order) : await settle(env, order)
      const now = await orderById(env, order.id)
      return { status: now?.status, session: state, refunded_cents: now?.refunded_cents }
    }
    case "switch_to_bank": {
      const order = await orderForCustomer(env, body.order_number, body.token, authorization)
      if (order.payment_method !== "card" || order.status !== "awaiting_payment") throw new PaymentError("not_switchable", 409)
      const current = order.stripe_session_id?.replace(/^replacing:/, "")
      if (current) {
        const state = await settle(env, order, current)
        if (state === "paid") return { status: "paid" }
        if (state === "open" && !(await closeOpenPage(env, order, current))) return { status: "paid" }
        const fresh = await orderById(env, order.id)
        if (fresh?.status !== "awaiting_payment") return { status: fresh?.status }
      }
      const switched = await rpc(env, "switch_to_bank_transfer", { p_order_id: order.id })
      // Too many orders already wait for a transfer under this email address: the order stays a card order.
      if (switched === "too_many_unpaid") throw new PaymentError("too_many_unpaid", 409)
      // Too many orders without an account already wait for a transfer in the whole shop: the same.
      if (switched === "too_many_guest_orders") throw new PaymentError("too_many_guest_orders", 409)
      // Something else happened to the order meanwhile (the shop cancelled it): say what it is now.
      if (switched !== "switched") return { status: (await orderById(env, order.id))?.status }
      return { status: "awaiting_payment", payment_method: "bank_transfer" }
    }
    case "sync":
      return env.stripeKey ? await syncAll(env) : { skipped: "not_configured" }
    case "refund_return":
      await requireOwner(env, authorization)
      return await refundReturn(env, String(body.return_id ?? ""), Number(body.amount_cents), !!body.restock)
    case "cancel_order":
      await requireOwner(env, authorization)
      return await cancelOrder(env, String(body.order_id ?? ""))
    default:
      throw new PaymentError("unknown_action")
  }
}

// ---------------------------------------------------------------------------
// Stripe's webhook
// ---------------------------------------------------------------------------

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")

async function signatureOk(secret: string, header: string | null, payload: string) {
  if (!header) return false
  const t = header.split(",").find((p) => p.startsWith("t="))?.slice(2)
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3))
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)))
  return sigs.some((s) => s.length === expected.length && [...s].every((c, i) => c === expected[i]))
}

export async function handleStripeWebhook(env: PayEnv, payload: string, signature: string | null) {
  if (!env.webhookSecret) throw new PaymentError("STRIPE_WEBHOOK_SECRET is missing", 503)
  if (!(await signatureOk(env.webhookSecret, signature, payload))) throw new PaymentError("bad_signature", 400)
  const event = JSON.parse(payload)
  const session = event.data?.object
  const orderId: string | undefined = session?.metadata?.order_id
  if (!orderId || !String(event.type).startsWith("checkout.session.")) return { ignored: event.type }
  const order = await orderById(env, orderId)
  if (!order) return { ignored: "unknown_order" }
  // Ask Stripe directly rather than trusting the event's copy.
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"].includes(event.type)) {
    return { state: await settle(env, order, session.id) }
  }
  return { ignored: event.type }
}
