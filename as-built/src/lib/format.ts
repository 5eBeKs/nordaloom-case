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

/** Latvian standard VAT rate, included in all prices. */
export const VAT_RATE = 0.21

/** The VAT portion contained in a VAT-inclusive amount. */
export function vatIncluded(cents: number) {
  return Math.round(cents - cents / (1 + VAT_RATE))
}
