// Email building blocks in the shop's look. Plain functions returning HTML
// strings with inline styles and tables (what email programs understand), so
// the same code can later run in a sending service.

export const C = {
  page: "#f1ebe1",
  card: "#fbf8f3",
  ink: "#2b2824",
  muted: "#6e675d",
  line: "#ddd4c5",
  sand: "#ece5d9",
  clay: "#a45a3a",
  moss: "#5e6b55",
}

const SERIF = "Georgia, 'Times New Roman', serif"
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

/** Escape text for HTML. Everything from the database goes through this. */
export function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const money = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" })
const moneyWhole = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
export const price = (cents: number) => (cents % 100 === 0 ? moneyWhole.format(cents / 100) : money.format(cents / 100))

const longDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Riga" })
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Riga" })
export const dayLong = (iso: string) => longDate.format(new Date(iso))
export const dateShort = (iso: string) => shortDate.format(new Date(iso))

export function paragraph(html: string, style = "") {
  return `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.65;color:${C.ink};${style}">${html}</p>`
}

export function muted(html: string) {
  return `<p style="margin:0 0 12px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">${html}</p>`
}

export function heading(text: string, size = 30) {
  return `<h1 style="margin:0 0 18px;font-family:${SERIF};font-weight:normal;font-size:${size}px;line-height:1.2;color:${C.ink};">${esc(text)}</h1>`
}

export function subheading(text: string) {
  return `<h2 style="margin:28px 0 12px;font-family:${SERIF};font-weight:normal;font-size:20px;line-height:1.3;color:${C.ink};">${esc(text)}</h2>`
}

export function eyebrow(text: string, colour = C.muted) {
  return `<p style="margin:0 0 10px;font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;color:${colour};">${esc(text)}</p>`
}

/** A button that works in every email program (a padded link inside a table cell). */
export function button(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>
<td style="background:${C.ink};"><a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#f7f3ec;text-decoration:none;">${esc(label)}</a></td>
</tr></table>`
}

/** A tinted box for the thing that matters most in the email. */
export function panel(inner: string, tint = C.sand) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;background:${tint};"><tr><td style="padding:22px 24px;">${inner}</td></tr></table>`
}

/** Label / value rows, e.g. bank details. */
export function rows(items: [string, string, boolean?][]) {
  const tr = items
    .map(
      ([label, value, strong]) => `<tr>
<td style="padding:7px 12px 7px 0;font-family:${SANS};font-size:13px;color:${C.muted};vertical-align:top;white-space:nowrap;">${esc(label)}</td>
<td style="padding:7px 0;font-family:${SANS};font-size:14px;color:${C.ink};${strong ? "font-weight:600;" : ""}">${value}</td>
</tr>`,
    )
    .join("")
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${tr}</table>`
}

export type ItemLine = { name: string; colour: string; size: string; quantity: number; image?: string | null; line_total_cents?: number }

export function itemList(items: ItemLine[], imageUrl: (path: string) => string) {
  const tr = items
    .map((i) => {
      const img = i.image
        ? `<img src="${esc(imageUrl(i.image))}" width="56" height="70" alt="" style="display:block;width:56px;height:70px;object-fit:cover;background:${C.sand};border:0;">`
        : `<div style="width:56px;height:70px;background:${C.sand};"></div>`
      const variant = [i.colour, i.size !== "One size" ? i.size : null, `Qty ${i.quantity}`].filter(Boolean).map(esc).join(" · ")
      return `<tr>
<td width="56" style="padding:12px 16px 12px 0;border-top:1px solid ${C.line};vertical-align:top;">${img}</td>
<td style="padding:12px 0;border-top:1px solid ${C.line};vertical-align:top;font-family:${SANS};">
  <div style="font-size:14px;color:${C.ink};">${esc(i.name)}</div>
  <div style="margin-top:3px;font-size:13px;color:${C.muted};">${variant}</div>
</td>
<td align="right" style="padding:12px 0 12px 12px;border-top:1px solid ${C.line};vertical-align:top;font-family:${SANS};font-size:14px;color:${C.ink};white-space:nowrap;">${i.line_total_cents !== undefined ? price(i.line_total_cents) : ""}</td>
</tr>`
    })
    .join("")
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-bottom:1px solid ${C.line};">${tr}</table>`
}

export function totals(lines: [string, string, "total" | "muted" | "discount" | undefined][]) {
  const tr = lines
    .map(([label, value, kind]) => {
      const colour = kind === "discount" ? C.moss : kind === "muted" ? C.muted : C.ink
      const size = kind === "total" ? "18px" : kind === "muted" ? "12px" : "14px"
      const family = kind === "total" ? SERIF : SANS
      const border = kind === "total" ? `border-top:1px solid ${C.line};padding-top:12px;` : ""
      return `<tr>
<td style="padding:5px 0;${border}font-family:${SANS};font-size:${kind === "muted" ? "12px" : "14px"};color:${colour};">${esc(label)}</td>
<td align="right" style="padding:5px 0;${border}font-family:${family};font-size:${size};color:${colour};white-space:nowrap;">${esc(value)}</td>
</tr>`
    })
    .join("")
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px;">${tr}</table>`
}

/** The whole email: page background, wordmark, card, footer. */
export function layout(o: { preheader: string; body: string; siteUrl: string; contactEmail: string; footerNote?: string }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Nordaloom</title>
<style>@media (max-width:480px){.card{padding:28px 20px !important}}</style></head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};"><tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
    <tr><td align="center" style="padding:0 0 24px;">
      <a href="${esc(o.siteUrl)}" style="text-decoration:none;font-family:${SERIF};font-size:26px;letter-spacing:0.5px;color:${C.ink};">Nordaloom</a>
      <div style="margin-top:6px;font-family:${SANS};font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${C.muted};">Knitted in Latvia</div>
    </td></tr>
    <tr><td class="card" style="background:${C.card};padding:40px 36px;border:1px solid ${C.line};">${o.body}
      <p style="margin:28px 0 0;font-family:${SERIF};font-size:16px;color:${C.ink};">Warmly,<br>the Nordaloom workshop</p>
    </td></tr>
    <tr><td align="center" style="padding:24px 16px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${C.muted};">
      ${o.footerNote ? `${o.footerNote}<br>` : ""}
      Questions? Just reply, or write to <a href="mailto:${esc(o.contactEmail)}" style="color:${C.muted};">${esc(o.contactEmail)}</a>.<br>
      Nordaloom SIA · Liela iela 12, Kuldiga, LV-3301, Latvia · <a href="${esc(o.siteUrl)}" style="color:${C.muted};">Visit the shop</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`
}
