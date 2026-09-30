import type { Category, Colour, Product } from "@/lib/catalogue"
import { colourway } from "@/components/art/colour"

// ---------------------------------------------------------------------------
// Text search
// ---------------------------------------------------------------------------

/** Lower case, no accents: "Kāpa" → "kapa". */
export function normalize(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

/** Everyday words people type, mapped to words the catalogue uses. */
const SYNONYMS: Record<string, string[]> = {
  jumper: ["sweater"],
  pullover: ["sweater"],
  knit: ["sweater", "cardigan"],
  turtleneck: ["rollneck"],
  polo: ["rollneck"],
  cardi: ["cardigan"],
  beanie: ["hat"],
  cap: ["hat"],
  toque: ["hat"],
  glove: ["mitten"],
  mitt: ["mitten"],
  throw: ["blanket"],
  plaid: ["blanket"],
  shawl: ["wrap", "scarf"],
  gray: ["grey"],
  cream: ["ecru"],
  white: ["ecru"],
  beige: ["oat"],
  wool: ["wool", "lambswool", "merino", "mohair"],
}

/** "sweaters" → "sweater", "socks" → "sock" (good enough for our words). */
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)

type Indexed = { product: Product; fields: { text: string; weight: number }[] }

export function indexProducts(products: Product[], categories: Category[]): Indexed[] {
  const catName = new Map(categories.map((c) => [c.slug, c.name]))
  return products.map((p) => ({
    product: p,
    fields: [
      { text: normalize(p.name), weight: 6 },
      { text: normalize(`${catName.get(p.category_slug) ?? ""} ${p.category_slug}`), weight: 4 },
      { text: normalize(p.colours.map((c) => `${c.name} ${familyOf(c).label}`).join(" ")), weight: 3 },
      { text: normalize(p.materials), weight: 2 },
      { text: normalize(p.short_description), weight: 1.5 },
      { text: normalize(`${p.description} ${p.details.join(" ")}`), weight: 0.5 },
    ],
  }))
}

function termMatches(text: string, term: string) {
  if (term.length <= 3) return new RegExp(`(^|[^a-z0-9])${term}`).test(text)
  return text.includes(term)
}

/**
 * Products matching every word of the query (in name, category, colour,
 * material or description), best matches first.
 */
export function searchProducts(index: Indexed[], query: string): Product[] {
  const words = normalize(query).split(/[^a-z0-9/]+/).filter(Boolean).map(singular)
  if (words.length === 0) return []

  const scored: { product: Product; score: number }[] = []
  for (const item of index) {
    let score = 0
    let all = true
    for (const w of words) {
      const variants = [w, ...(SYNONYMS[w] ?? [])]
      let best = 0
      for (const f of item.fields) {
        if (variants.some((v) => termMatches(f.text, v))) best = Math.max(best, f.weight)
      }
      if (best === 0) {
        all = false
        break
      }
      score += best
    }
    if (all) scored.push({ product: item.product, score })
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.product)
}

export const SEARCH_SUGGESTIONS = ["Sweaters", "Cardigans", "Mittens", "Merino", "Mohair", "Green", "Grey", "Blankets"]

// ---------------------------------------------------------------------------
// Colour families (worked out from the colour itself, so new colours sort
// themselves)
// ---------------------------------------------------------------------------

export type ColourFamily = { key: string; label: string; swatch: string }

export const FAMILIES: ColourFamily[] = [
  { key: "cream", label: "Cream & ecru", swatch: "#ede6d6" },
  { key: "beige", label: "Oat & camel", swatch: "#c9ae8a" },
  { key: "brown", label: "Browns", swatch: "#6e4a36" },
  { key: "grey", label: "Greys", swatch: "#a3a19b" },
  { key: "charcoal", label: "Charcoal & black", swatch: "#3e3d3b" },
  { key: "yellow", label: "Mustard & ochre", swatch: "#c99a3b" },
  { key: "red", label: "Reds & rust", swatch: "#9e3a32" },
  { key: "pink", label: "Pinks & purples", swatch: "#9b7a8c" },
  { key: "green", label: "Greens", swatch: "#4f6b4d" },
  { key: "blue", label: "Blues", swatch: "#4b6280" },
]

function hsl(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
  }
  return { h, s, l }
}

export function familyOf(c: Colour): ColourFamily {
  const { main } = colourway(c.name, c.hex)
  const { h, s, l } = hsl(main)
  const pick = (key: string) => FAMILIES.find((f) => f.key === key)!
  if (l >= 0.82) return pick("cream")
  if (s < 0.11) return pick(l < 0.3 ? "charcoal" : "grey")
  if (h >= 20 && h < 50 && s < 0.42 && l >= 0.45) return pick("beige")
  if (h >= 12 && h < 45 && s < 0.45 && l < 0.45) return pick("brown")
  if (h >= 30 && h < 65) return pick("yellow")
  if (h < 30 || h >= 345) return pick(l > 0.62 ? "pink" : "red")
  if (h >= 65 && h < 170) return pick("green")
  if (h >= 170 && h < 255) return pick("blue")
  return pick("pink")
}

// ---------------------------------------------------------------------------
// Sizes and prices
// ---------------------------------------------------------------------------

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "S/M", "M/L", "36–38", "39–41", "42–44", "45–47", "One size"]

export function sortSizes(sizes: string[]) {
  const rank = (s: string) => {
    const i = SIZE_ORDER.indexOf(s)
    return i === -1 ? SIZE_ORDER.length : i
  }
  return [...sizes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export const PRICE_BANDS = [
  { key: "0-50", label: "Under €50", min: 0, max: 5000 },
  { key: "50-100", label: "€50 – €100", min: 5000, max: 10000 },
  { key: "100-150", label: "€100 – €150", min: 10000, max: 15000 },
  { key: "150-200", label: "€150 – €200", min: 15000, max: 20000 },
  { key: "200+", label: "€200 and more", min: 20000, max: Infinity },
]
