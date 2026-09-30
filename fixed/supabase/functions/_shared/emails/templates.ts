// The shop's emails. renderEmail() turns an outbox row (kind + the data saved
// at that moment) into subject, HTML and plain text. No browser code here, so
// a sending service can use the same file.
import {
  button,
  C,
  dateShort,
  dayLong,
  esc,
  eyebrow,
  heading,
  itemList,
  layout,
  muted,
  panel,
  paragraph,
  price,
  rows,
  subheading,
  totals,
  type ItemLine,
} from "./layout.ts"

export type EmailKind =
  | "order_confirmation"
  | "payment_reminder"
  | "order_cancelled"
  | "payment_received"
  | "payment_returned"
  | "order_shipped"
  | "order_delivered"
  | "return_approved"
  | "return_refused"
  | "refund_sent"
  | "newsletter_welcome"
  | "password_reset"

export const EMAIL_KINDS: { kind: EmailKind; label: string; when: string }[] = [
  { kind: "order_confirmation", label: "Order confirmation", when: "When an order is placed" },
  { kind: "payment_reminder", label: "Payment reminder", when: "Two days before the payment deadline, if unpaid" },
  { kind: "order_cancelled", label: "Order cancelled", when: "When an unpaid order passes its payment deadline, or you cancel an order" },
  { kind: "payment_received", label: "Payment received", when: "When you mark an order as paid" },
  { kind: "payment_returned", label: "Payment returned", when: "When a card payment arrives for an order that was already cancelled" },
  { kind: "order_shipped", label: "Shipped", when: "When you mark an order as shipped" },
  { kind: "order_delivered", label: "Delivered", when: "When you mark an order as delivered" },
  { kind: "return_approved", label: "Return approved", when: "When you approve a return" },
  { kind: "return_refused", label: "Return refused", when: "When you refuse a return" },
  { kind: "refund_sent", label: "Refund sent", when: "When you mark a return as refunded" },
  { kind: "newsletter_welcome", label: "Newsletter welcome", when: "When someone joins the newsletter" },
  { kind: "password_reset", label: "Password reset", when: "When someone asks to reset their password" },
]

export const kindLabel = (k: string) => EMAIL_KINDS.find((x) => x.kind === k)?.label ?? k

type Bank = { recipient: string; iban: string; bic: string; bank_name: string }

/** The order snapshot saved with each order email (see order_email_data() in the database). */
export type OrderData = {
  order_number: string
  access_token: string
  email: string
  full_name: string
  first_name: string
  status: string
  items: (ItemLine & { unit_price_cents: number; line_total_cents: number })[]
  subtotal_cents: number
  discount_code: string | null
  discount_cents: number
  shipping_label: string
  shipping_cents: number
  total_cents: number
  vat_cents: number
  payment_reference: string
  payment_due_at: string | null
  address_line1: string
  address_line2: string
  city: string
  postal_code: string
  country: string
  parcel_locker: string
  tracking_number: string
  delivered_at: string | null
  return_until: string | null
  return_days: number
  is_account_order: boolean
  /** Missing on emails from before card payments existed: treat as bank transfer. */
  payment_method?: "bank_transfer" | "card"
  card_brand?: string | null
  card_last4?: string | null
  /** Why a cancelled order was cancelled: not paid in time, or by the shop. */
  cancel_reason?: "not_paid" | "by_shop" | null
  paid_at?: string | null
  refunded_cents?: number
  bank: Bank
  site_url: string
  contact_email: string
  return?: {
    return_number: string
    reason: string
    details: string
    shop_note: string
    refund_cents: number | null
    refund_method?: "bank_transfer" | "card" | null
    items: ItemLine[]
  }
  return_address?: string
}

export type WelcomeData = {
  email: string
  site_url: string
  contact_email: string
  code: { code: string; kind: "percent" | "fixed"; value: number; first_order_only: boolean; min_order_cents: number | null; ends_at: string | null } | null
}

export type ResetData = {
  email: string
  first_name: string | null
  /** The one-time link; left out of the copy kept in the admin. */
  link: string | null
  expires_minutes: number
  site_url: string
  contact_email: string
}

export type RenderContext = {
  /** Public URL of a stored product photo. */
  imageUrl: (path: string) => string
}

export type RenderedEmail = { subject: string; preheader: string; html: string; text: string }

// Kept here (not imported from the shop) so templates run anywhere.
const COUNTRIES: Record<string, string> = {
  LV: "Latvia", LT: "Lithuania", EE: "Estonia", AT: "Austria", BE: "Belgium", BG: "Bulgaria", HR: "Croatia", CY: "Cyprus",
  CZ: "Czechia", DK: "Denmark", FI: "Finland", FR: "France", DE: "Germany", GR: "Greece", HU: "Hungary", IE: "Ireland",
  IT: "Italy", LU: "Luxembourg", MT: "Malta", NL: "Netherlands", PL: "Poland", PT: "Portugal", RO: "Romania",
  SK: "Slovakia", SI: "Slovenia", ES: "Spain", SE: "Sweden",
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const orderLink = (d: OrderData) => `${d.site_url}/order/${encodeURIComponent(d.order_number)}?token=${encodeURIComponent(d.access_token)}`

function bankPanel(d: OrderData) {
  const b = d.bank
  return panel(
    eyebrow("Pay by bank transfer", C.clay) +
      rows([
        ["Recipient", esc(b.recipient)],
        ["IBAN", `<span style="font-family:Menlo,Consolas,monospace;">${esc(b.iban)}</span>`],
        ...(b.bic ? ([["BIC", esc(b.bic)]] as [string, string][]) : []),
        ...(b.bank_name ? ([["Bank", esc(b.bank_name)]] as [string, string][]) : []),
        ["Reference", `<span style="font-family:Menlo,Consolas,monospace;">${esc(d.payment_reference)}</span>`, true],
        ["Amount", esc(price(d.total_cents)), true],
        ...(d.payment_due_at ? ([["Pay by", esc(dayLong(d.payment_due_at))]] as [string, string][]) : []),
      ]),
  )
}

function orderTotals(d: OrderData) {
  const lines: [string, string, "total" | "muted" | "discount" | undefined][] = [["Subtotal", price(d.subtotal_cents), undefined]]
  if (d.discount_cents > 0) lines.push([`Discount · ${d.discount_code}`, `−${price(d.discount_cents)}`, "discount"])
  lines.push([`Delivery · ${d.shipping_label}`, d.shipping_cents === 0 ? "Free" : price(d.shipping_cents), undefined])
  lines.push(["Total", price(d.total_cents), "total"])
  lines.push(["Includes 21% VAT", price(d.vat_cents), "muted"])
  return totals(lines)
}

function addressBlock(d: OrderData) {
  const lines = [d.full_name, d.address_line1, d.address_line2, `${d.postal_code} ${d.city}`, COUNTRIES[d.country] ?? d.country].filter(Boolean)
  return (
    `<p style="margin:0;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${C.ink};">` +
    `<strong style="font-weight:600;">${esc(d.shipping_label)}</strong>${d.parcel_locker ? ` — ${esc(d.parcel_locker)}` : ""}<br>` +
    lines.map(esc).join("<br>") +
    `</p>`
  )
}

const textItems = (items: ItemLine[]) =>
  items.map((i) => `- ${i.name} (${[i.colour, i.size !== "One size" ? i.size : null].filter(Boolean).join(", ")}) × ${i.quantity}${i.line_total_cents !== undefined ? ` — ${price(i.line_total_cents)}` : ""}`).join("\n")

const textBank = (d: OrderData) =>
  [
    `Recipient: ${d.bank.recipient}`,
    `IBAN: ${d.bank.iban}`,
    d.bank.bic && `BIC: ${d.bank.bic}`,
    d.bank.bank_name && `Bank: ${d.bank.bank_name}`,
    `Reference: ${d.payment_reference}`,
    `Amount: ${price(d.total_cents)}`,
    d.payment_due_at && `Pay by: ${dayLong(d.payment_due_at)}`,
  ]
    .filter(Boolean)
    .join("\n")

const sign = "\n\nWarmly,\nthe Nordaloom workshop"

const BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", maestro: "Maestro", discover: "Discover", jcb: "JCB", unionpay: "UnionPay", diners: "Diners Club", cartes_bancaires: "Cartes Bancaires" }
/** "your Visa ending 4242", or "your card" */
const cardName = (d: OrderData) =>
  d.card_last4 ? `your ${BRANDS[d.card_brand ?? ""] ?? "card"} ending ${d.card_last4}` : "your card"
const isCard = (d: OrderData) => d.payment_method === "card"

function wrap(d: { site_url: string; contact_email: string }, subject: string, preheader: string, body: string, text: string, footerNote?: string): RenderedEmail {
  return { subject, preheader, html: layout({ preheader, body, siteUrl: d.site_url, contactEmail: d.contact_email, footerNote }), text: text.trim() + sign }
}

// ---------------------------------------------------------------------------
// The emails
// ---------------------------------------------------------------------------

function orderConfirmation(d: OrderData, ctx: RenderContext) {
  const due = d.payment_due_at ? dayLong(d.payment_due_at) : null
  const body =
    eyebrow(`Order ${d.order_number}`) +
    heading(`Thank you, ${d.first_name}.`) +
    paragraph(
      `Your order is placed and your pieces are set aside for you${due ? ` until <strong>${esc(due)}</strong>` : ""}. ` +
        `As soon as your bank transfer arrives, we'll wrap everything and send it on its way.`,
    ) +
    bankPanel(d) +
    muted(`Please write <strong style="color:${C.ink};">${esc(d.payment_reference)}</strong> as the payment reference so we can match your transfer to your order. If it hasn't arrived by the deadline, the order is cancelled and the pieces go back on the shelf.`) +
    subheading("What you ordered") +
    itemList(d.items, ctx.imageUrl) +
    orderTotals(d) +
    subheading("Delivery") +
    addressBlock(d) +
    `<div style="height:24px"></div>` +
    button("View your order", orderLink(d))
  const text = `Thank you, ${d.first_name}.

Your order ${d.order_number} is placed and your pieces are set aside for you${due ? ` until ${due}` : ""}. As soon as your bank transfer arrives, we'll send it on its way.

PAY BY BANK TRANSFER
${textBank(d)}

Please use ${d.payment_reference} as the payment reference.

WHAT YOU ORDERED
${textItems(d.items)}
Total: ${price(d.total_cents)}${d.discount_cents > 0 ? ` (including ${price(d.discount_cents)} off with ${d.discount_code})` : ""}

Your order: ${orderLink(d)}`
  return wrap(d, `Your order ${d.order_number} — how to pay`, `Thank you for your order. Here are the bank details and your payment reference.`, body, text)
}

function paymentReminder(d: OrderData, ctx: RenderContext) {
  const due = d.payment_due_at ? dayLong(d.payment_due_at) : "soon"
  const body =
    eyebrow(`Order ${d.order_number}`) +
    heading("Your pieces are still waiting for you") +
    paragraph(`A gentle reminder: we haven't received the payment for your order yet. We're holding your pieces until <strong>${esc(due)}</strong> — after that the order is cancelled and they go back on the shelf for someone else.`) +
    paragraph(`If you've already paid, thank you — a transfer can take a working day to arrive, and you can ignore this email.`) +
    bankPanel(d) +
    subheading("Your order") +
    itemList(d.items, ctx.imageUrl) +
    `<div style="height:24px"></div>` +
    button("View your order", orderLink(d))
  const text = `Your pieces are still waiting for you.

We haven't received the payment for order ${d.order_number} yet. We're holding your pieces until ${due} — after that the order is cancelled.

If you've already paid, thank you — a transfer can take a working day to arrive.

${textBank(d)}

Your order: ${orderLink(d)}`
  return wrap(d, `A reminder about order ${d.order_number}`, `We're holding your pieces until ${due}.`, body, text)
}

function orderCancelled(d: OrderData, ctx: RenderContext) {
  if (d.cancel_reason === "by_shop") return cancelledByShop(d, ctx)
  if (isCard(d)) return cardNotCompleted(d, ctx)
  const due = d.payment_due_at ? dayLong(d.payment_due_at) : null
  const code = d.discount_cents > 0 && d.discount_code ? d.discount_code : null
  const body =
    eyebrow(`Order ${d.order_number}`) +
    heading("Your order has been cancelled") +
    paragraph(
      `We didn't receive the payment for your order${due ? ` by <strong>${esc(due)}</strong>` : " in time"}, so we've cancelled it and put the pieces back on the shelf. There's nothing you need to do.`,
    ) +
    paragraph(`If you'd still like them, you're very welcome to order again while they're in stock${code ? ` — and your code <strong>${esc(code)}</strong> can be used again` : ""}.`) +
    subheading("What was in the order") +
    itemList(d.items, ctx.imageUrl) +
    `<div style="height:24px"></div>` +
    button("Visit the shop", `${d.site_url}/shop`) +
    muted(`If you did send the payment, please reply to this email with the date you paid and we'll sort it out.`)
  const text = `Your order has been cancelled.

We didn't receive the payment for order ${d.order_number}${due ? ` by ${due}` : " in time"}, so we've cancelled it and put the pieces back on the shelf. There's nothing you need to do.

If you'd still like them, you're very welcome to order again while they're in stock${code ? ` — and your code ${code} can be used again` : ""}.

${textItems(d.items)}

If you did send the payment, please reply to this email with the date you paid and we'll sort it out.

Visit the shop: ${d.site_url}/shop`
  return wrap(d, `Your order ${d.order_number} has been cancelled`, `We didn't receive the payment in time, so the pieces are back on the shelf.`, body, text)
}

/** A card order whose payment page expired without a payment. */
function cardNotCompleted(d: OrderData, ctx: RenderContext) {
  const code = d.discount_cents > 0 && d.discount_code ? d.discount_code : null
  const body =
    eyebrow(`Order ${d.order_number}`) +
    heading("Your card payment wasn't finished") +
    paragraph(`It looks like the payment for your order didn't go through — nothing has been taken from your card. We held your pieces for a while, and have now put them back on the shelf.`) +
    paragraph(`If you'd still like them, you're very welcome to order again while they're in stock${code ? ` — your code <strong>${esc(code)}</strong> can be used again` : ""}.`) +
    subheading("What was in the order") +
    itemList(d.items, ctx.imageUrl) +
    `<div style="height:24px"></div>` +
    button("Visit the shop", `${d.site_url}/shop`) +
    muted(`Had trouble paying? Reply to this email and we'll help.`)
  const text = `Your card payment wasn't finished.

The payment for order ${d.order_number} didn't go through — nothing has been taken from your card. We held your pieces for a while, and have now put them back on the shelf.

If you'd still like them, you're very welcome to order again while they're in stock${code ? ` — your code ${code} can be used again` : ""}.

${textItems(d.items)}

Had trouble paying? Reply to this email and we'll help.

Visit the shop: ${d.site_url}/shop`
  return wrap(d, `Your order ${d.order_number} wasn't paid`, `Nothing was taken from your card, and the pieces are back on the shelf.`, body, text)
}

/** The shop cancelled the order: says so, and says what happens to any money. */
function cancelledByShop(d: OrderData, ctx: RenderContext) {
  const paid = !!d.paid_at
  const money = !paid
    ? isCard(d)
      ? `Nothing has been taken from your card.`
      : `Please don't send the payment for it. If you have already made the transfer, reply to this email and we'll send it straight back.`
    : isCard(d)
      ? `We've returned ${price(d.refunded_cents || d.total_cents)} to ${cardName(d)}; it usually shows within a few working days.`
      : `We'll return the ${price(d.total_cents)} you paid to the account it came from within a few working days.`
  const body =
    eyebrow(`Order ${d.order_number}`) +
    heading("We've cancelled your order") +
    paragraph(`We're sorry — we've had to cancel your order, and its pieces are no longer set aside for you. ${esc(money)}`) +
    paragraph(`If this comes as a surprise, reply to this email and we'll explain.`) +
    subheading("What was in the order") +
    itemList(d.items, ctx.imageUrl) +
    `<div style="height:24px"></div>` +
    button("Visit the shop", `${d.site_url}/shop`)
  const text = `We've cancelled your order.

We're sorry — we've had to cancel order ${d.order_number}, and its pieces are no longer set aside for you. ${money}

If this comes as a surprise, reply to this email and we'll explain.

${textItems(d.items)}

Visit the shop: ${d.site_url}/shop`
  return wrap(
    d,
    `Your order ${d.order_number} has been cancelled`,
    paid ? `We've cancelled your order and are returning your payment.` : isCard(d) ? `Nothing was taken from your card.` : `Please don't send the payment.`,
    body,
    text,
  )
}

/** A card payment that arrived after its order had been cancelled: the money went straight back. */
function paymentReturned(d: OrderData) {
  const amount = price(d.refunded_cents || d.total_cents)
  const body =
    eyebrow(`Order ${d.order_number}`) +
    heading("Your payment has been returned") +
    paragraph(`Your card payment of <strong>${esc(amount)}</strong> reached us after this order had been cancelled, so we couldn't accept it. We've sent the whole amount back to ${esc(cardName(d))}; it usually shows within a few working days.`) +
    paragraph(`The order stays cancelled and nothing will be sent. If you'd still like the pieces, you're very welcome to order again while they're in stock.`) +
    button("Visit the shop", `${d.site_url}/shop`) +
    muted(`Questions about the refund? Reply to this email and we'll help.`)
  const text = `Your payment has been returned.

Your card payment of ${amount} for order ${d.order_number} reached us after the order had been cancelled, so we couldn't accept it. We've sent the whole amount back to ${cardName(d)}; it usually shows within a few working days.

The order stays cancelled and nothing will be sent. If you'd still like the pieces, you're very welcome to order again while they're in stock.

Questions about the refund? Reply to this email and we'll help.

Visit the shop: ${d.site_url}/shop`
  return wrap(d, `Your payment for ${d.order_number} has been returned`, `${amount} is on its way back to your card.`, body, text)
}

function paymentReceived(d: OrderData, ctx: RenderContext) {
  const card = isCard(d)
  const body =
    eyebrow(`Order ${d.order_number}`) +
    heading(card ? `Thank you, ${d.first_name}` : "Payment received — thank you") +
    paragraph(
      card
        ? `Your payment by ${esc(cardName(d))} has gone through, and your order is ours to pack. We're now folding and wrapping your pieces, and we'll write again as soon as they're on their way.`
        : `Your transfer has arrived. We're now folding, wrapping and packing your order, and we'll write again as soon as it's on its way.`,
    ) +
    itemList(d.items, ctx.imageUrl) +
    orderTotals(d) +
    (card ? subheading("Delivery") + addressBlock(d) : "") +
    `<div style="height:24px"></div>` +
    button("View your order", orderLink(d))
  const text = `${card ? `Thank you, ${d.first_name}.` : "Payment received — thank you."}

${card ? `Your payment for order ${d.order_number} by ${cardName(d)} has gone through.` : `Your transfer for order ${d.order_number} has arrived.`} We're now packing your order and will write again as soon as it's on its way.

${textItems(d.items)}
Total: ${price(d.total_cents)}

Your order: ${orderLink(d)}`
  return wrap(
    d,
    card ? `Your order ${d.order_number} is paid — thank you` : `Payment received for ${d.order_number}`,
    card ? `Paid by card. We're packing your order now.` : `We're packing your order now.`,
    body,
    text,
  )
}

function orderShipped(d: OrderData, ctx: RenderContext) {
  const locker = d.shipping_label.toLowerCase().includes("locker")
  const body =
    eyebrow(`Order ${d.order_number}`) +
    heading("Your parcel is on its way") +
    paragraph(
      locker
        ? `Your order has left the workshop and is heading to the parcel locker you chose. Omniva will send you a text with the code when it's ready to collect.`
        : `Your order has left the workshop and is on its way to you.`,
    ) +
    (d.tracking_number
      ? panel(eyebrow("Tracking number") + `<p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:18px;letter-spacing:1px;color:${C.ink};">${esc(d.tracking_number)}</p>`)
      : "") +
    subheading("Going to") +
    addressBlock(d) +
    subheading("In the parcel") +
    itemList(d.items, ctx.imageUrl) +
    `<div style="height:24px"></div>` +
    button("View your order", orderLink(d))
  const text = `Your parcel is on its way.

Order ${d.order_number} has left the workshop${locker ? " and is heading to your parcel locker. Omniva will text you the code when it's ready" : ""}.
${d.tracking_number ? `\nTracking number: ${d.tracking_number}\n` : ""}
${textItems(d.items)}

Your order: ${orderLink(d)}`
  return wrap(d, `Your Nordaloom parcel is on its way`, d.tracking_number ? `Tracking number ${d.tracking_number}` : `Order ${d.order_number} has left the workshop.`, body, text)
}

function orderDelivered(d: OrderData, ctx: RenderContext) {
  const until = d.return_until ? dateShort(d.return_until) : null
  const returns = d.is_account_order
    ? `If something isn't right, you can ask for a return from your account until <strong>${esc(until ?? "")}</strong>.`
    : `If something isn't right, just reply to this email by <strong>${esc(until ?? "")}</strong> and we'll help.`
  const body =
    eyebrow(`Order ${d.order_number}`) +
    heading("Delivered — we hope you love it") +
    paragraph(`Your parcel has arrived. A few things to keep your new pieces at their best: air them between wears, wash them rarely and by hand, and always dry them flat.`) +
    itemList(d.items, ctx.imageUrl) +
    `<div style="height:20px"></div>` +
    (until ? paragraph(returns) : "") +
    button("How to care for wool", `${d.site_url}/care`) +
    (d.is_account_order
      ? muted(`Once you've worn them a little, we'd love a review: a few stars and a word on how they fit help the next person choose. <a href="${esc(`${d.site_url}/account/reviews`)}" style="color:${C.ink};">Write a review</a>`)
      : muted(`If you have a moment, we'd love to hear how they fit — just reply to this email.`))
  const text = `Delivered — we hope you love it.

Your order ${d.order_number} has arrived. Air your pieces between wears, wash them rarely and by hand, and always dry them flat.

${until ? (d.is_account_order ? `If something isn't right, you can ask for a return from your account until ${until}.` : `If something isn't right, reply to this email by ${until} and we'll help.`) : ""}

Caring for wool: ${d.site_url}/care
${d.is_account_order ? `
Once you've worn them a little, we'd love a review: ${d.site_url}/account/reviews` : ""}`
  return wrap(d, `Delivered — we hope you love it`, `A few words on caring for your new pieces.`, body, text)
}

function returnApproved(d: OrderData, ctx: RenderContext) {
  const r = d.return!
  const address = (d.return_address ?? "").split("\n").map(esc).join("<br>")
  const body =
    eyebrow(`Return ${r.return_number}`) +
    heading("Your return is approved") +
    paragraph(`Thank you for letting us know. Please send the pieces below back to us — once they arrive, we'll refund you to the account you paid from.`) +
    itemList(r.items, ctx.imageUrl) +
    `<div style="height:8px"></div>` +
    panel(
      eyebrow("Send them to") +
        `<p style="margin:0 0 12px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.ink};">${address}</p>` +
        `<p style="margin:0;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:${C.muted};">Please put a note with <strong style="color:${C.ink};">${esc(r.return_number)}</strong> inside the parcel.</p>`,
    ) +
    (r.shop_note ? paragraph(`<em>“${esc(r.shop_note)}”</em>`) : "")
  const text = `Your return ${r.return_number} is approved.

Please send these pieces back to us:
${textItems(r.items)}

Send them to:
${d.return_address ?? ""}

Put a note with ${r.return_number} inside the parcel. Once they arrive, we'll refund you to the account you paid from.
${r.shop_note ? `\nA note from us: ${r.shop_note}\n` : ""}`
  return wrap(d, `Your return ${r.return_number} is approved`, `Here's where to send the pieces.`, body, text)
}

function returnRefused(d: OrderData, ctx: RenderContext) {
  const r = d.return!
  const body =
    eyebrow(`Return ${r.return_number}`) +
    heading("About your return request") +
    paragraph(`Thank you for writing to us about your order ${esc(d.order_number)}. We've looked at your request, and unfortunately we can't accept this return.`) +
    (r.shop_note ? panel(eyebrow("Why") + `<p style="margin:0;font-family:Georgia,serif;font-size:16px;line-height:1.6;color:${C.ink};">${esc(r.shop_note)}</p>`) : "") +
    itemList(r.items, ctx.imageUrl) +
    `<div style="height:20px"></div>` +
    paragraph(`If you'd like to talk it over, just reply to this email — we read every one.`)
  const text = `About your return request ${r.return_number}.

We've looked at your request for order ${d.order_number}, and unfortunately we can't accept this return.
${r.shop_note ? `\nWhy: ${r.shop_note}\n` : ""}
If you'd like to talk it over, just reply to this email.`
  return wrap(d, `About your return request ${r.return_number}`, `We've looked at your request.`, body, text)
}

/** A return closed with nothing refunded: because the order's money had all gone back already, or not. */
function returnClosed(d: OrderData, ctx: RenderContext) {
  const r = d.return!
  const allBack = (d.refunded_cents ?? 0) >= d.total_cents
  const why = allBack
    ? "There is no further refund with it: what you paid for this order has already been returned to you."
    : "It was closed without a refund."
  const body =
    eyebrow(`Return ${r.return_number}`) +
    heading(`Your return ${r.return_number} is closed`) +
    paragraph(`${esc(why)}${r.shop_note ? ` A note from us: \u201c${esc(r.shop_note)}\u201d` : ""}`) +
    itemList(r.items, ctx.imageUrl) +
    `<div style="height:20px"></div>` +
    paragraph(`If that doesn't match what you expected, reply to this email and we'll look into it.`)
  const text = `Your return ${r.return_number} is closed.

${why}${r.shop_note ? ` A note from us: "${r.shop_note}"` : ""}

If that doesn't match what you expected, reply to this email and we'll look into it.`
  return wrap(d, `Your return ${r.return_number} is closed`, allBack ? `Nothing further is refunded with it.` : `It was closed without a refund.`, body, text)
}

function refundSent(d: OrderData, ctx: RenderContext) {
  const r = d.return!
  if (!r.refund_cents) return returnClosed(d, ctx)
  const amount = price(r.refund_cents ?? 0)
  const toCard = (r.refund_method ?? (isCard(d) ? "card" : "bank_transfer")) === "card"
  const where = toCard
    ? `back to ${esc(cardName(d))}. Card refunds usually take 5–10 working days to show on your statement.`
    : `to the account you paid from. Depending on your bank, it can take a working day or two to appear.`
  const body =
    eyebrow(`Return ${r.return_number}`) +
    heading(`Your refund of ${amount} is on its way`) +
    paragraph(`Your parcel has arrived back at the workshop, and we've sent <strong>${esc(amount)}</strong> ${where}`) +
    itemList(r.items, ctx.imageUrl) +
    `<div style="height:20px"></div>` +
    paragraph(`Thank you for giving Nordaloom a try. We hope to see you again.`)
  const text = `Your refund of ${amount} is on its way.

Your return ${r.return_number} has arrived back at the workshop, and we've sent ${amount} ${where.replace(/<[^>]+>/g, "")}`
  return wrap(
    d,
    `Your refund of ${amount} is on its way`,
    toCard ? `We've refunded ${amount} to your card.` : `We've sent ${amount} to the account you paid from.`,
    body,
    text,
  )
}

function newsletterWelcome(d: WelcomeData) {
  const code = d.code
  const off = code ? (code.kind === "percent" ? `${code.value}% off` : `${price(code.value)} off`) : ""
  const conditions = code
    ? [code.first_order_only ? "your first order" : "your next order", code.min_order_cents ? `over ${price(code.min_order_cents)}` : null, code.ends_at ? `until ${dateShort(new Date(new Date(code.ends_at).getTime() - 1000).toISOString())}` : null]
        .filter(Boolean)
        .join(" ")
    : ""
  const body =
    eyebrow("Letters from the workshop") +
    heading("Welcome to Nordaloom") +
    paragraph(`Thank you for joining us. A few times a season we'll write with new pieces, small-batch restocks and notes from the workshop in Latvia — never more than that, and never anything we wouldn't want to read ourselves.`) +
    (code
      ? panel(
          eyebrow("A welcome from us", C.clay) +
            `<p style="margin:0 0 6px;font-family:Georgia,serif;font-size:24px;color:${C.ink};">${esc(off)} ${esc(conditions)}</p>` +
            `<p style="margin:14px 0 0;"><span style="display:inline-block;padding:10px 18px;border:1px dashed ${C.ink};font-family:Menlo,Consolas,monospace;font-size:20px;letter-spacing:3px;color:${C.ink};">${esc(code.code)}</span></p>` +
            `<p style="margin:12px 0 0;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:${C.muted};">Type the code in your bag before checkout.</p>`,
        )
      : "") +
    button("Shop the collection", `${d.site_url}/shop`)
  const text = `Welcome to Nordaloom.

Thank you for joining us. A few times a season we'll write with new pieces, small-batch restocks and notes from the workshop in Latvia.
${code ? `\nA welcome from us: ${off} ${conditions} with the code ${code.code}. Type it in your bag before checkout.\n` : ""}
Shop the collection: ${d.site_url}/shop`
  return wrap(
    d,
    code ? `Welcome to Nordaloom — ${off} ${code.first_order_only ? "your first order" : ""}`.trim() : "Welcome to Nordaloom",
    code ? `Your code ${code.code} is inside.` : "Letters from the workshop, a few times a season.",
    body,
    text,
    `You're receiving this because you joined the Nordaloom newsletter. Don't want these letters? Reply and we'll take you off the list.`,
  )
}

function passwordReset(d: ResetData) {
  const link = d.link ?? `${d.site_url}/reset-password`
  const hours = d.expires_minutes >= 60 ? `${Math.round(d.expires_minutes / 60)} hour${d.expires_minutes >= 120 ? "s" : ""}` : `${d.expires_minutes} minutes`
  const body =
    eyebrow("Your account") +
    heading(d.first_name ? `Hello, ${d.first_name}` : "Hello") +
    paragraph(`Someone — hopefully you — asked to reset the password for the Nordaloom account <strong>${esc(d.email)}</strong>. Choose a new one with the button below.`) +
    button("Choose a new password", link) +
    muted(`The link works once, for ${esc(hours)}. If you asked more than once, use the newest email. If you didn't ask for this, you can ignore it — your password stays as it is.`)
  const text = `${d.first_name ? `Hello, ${d.first_name}.` : "Hello."}

Someone — hopefully you — asked to reset the password for the Nordaloom account ${d.email}. Choose a new one here:

${link}

The link works once, for ${hours}. If you asked more than once, use the newest email. If you didn't ask for this, you can ignore it — your password stays as it is.`
  return wrap(d, "Reset your Nordaloom password", "Choose a new password for your account.", body, text)
}

export function renderEmail(kind: string, data: unknown, ctx: RenderContext): RenderedEmail {
  const d = data as OrderData
  switch (kind as EmailKind) {
    case "order_confirmation":
      return orderConfirmation(d, ctx)
    case "payment_reminder":
      return paymentReminder(d, ctx)
    case "order_cancelled":
      return orderCancelled(d, ctx)
    case "payment_received":
      return paymentReceived(d, ctx)
    case "payment_returned":
      return paymentReturned(d)
    case "order_shipped":
      return orderShipped(d, ctx)
    case "order_delivered":
      return orderDelivered(d, ctx)
    case "return_approved":
      return returnApproved(d, ctx)
    case "return_refused":
      return returnRefused(d, ctx)
    case "refund_sent":
      return refundSent(d, ctx)
    case "newsletter_welcome":
      return newsletterWelcome(data as WelcomeData)
    case "password_reset":
      return passwordReset(data as ResetData)
    default:
      return { subject: kind, preheader: "", html: "<p>Unknown email.</p>", text: kind }
  }
}
