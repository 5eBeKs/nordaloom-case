const whole = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
})
const exact = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" })

/** Formats euro cents, dropping ".00" for whole amounts: €159, €12.50 */
export function formatPrice(cents: number) {
  return cents % 100 === 0 ? whole.format(cents / 100) : exact.format(cents / 100)
}

/**
 * The shop's clock. Dates and deadlines are shown in Latvian time on every
 * device, the same as in the shop's emails, so "pay by 3 October" is the same
 * day for everyone (and the day the order really cancels itself).
 */
export const SHOP_TIME_ZONE = "Europe/Riga"

export const shopDate = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: SHOP_TIME_ZONE, ...options })

/** A calendar date that comes from the shop as YYYY-MM-DD (already a day in the shop's time). */
export const calendarDate = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options })

/** The day (YYYY-MM-DD) a moment falls on in the shop's time. */
export const shopDay = (at: Date | string | number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: SHOP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at))

/** The moment a day (YYYY-MM-DD) begins in the shop's time, whatever the clock change. */
export function shopDayStart(day: string) {
  const wall = Date.parse(`${day}T00:00:00Z`)
  // How far the shop's clock is ahead of UTC around then; asked twice, so the nights the clocks change come out right.
  const ahead = (at: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone: SHOP_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(at))
        .map((x) => [x.type, x.value]),
    )
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - at
  }
  const first = wall - ahead(wall)
  return new Date(wall - ahead(first))
}

/** Latvian standard VAT rate, included in all prices. */
export const VAT_RATE = 0.21

/** The VAT portion contained in a VAT-inclusive amount. */
export function vatIncluded(cents: number) {
  return Math.round(cents - cents / (1 + VAT_RATE))
}
