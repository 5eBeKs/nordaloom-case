// Small colour helpers for the drawn product placeholders.

type RGB = [number, number, number]

function toRgb(hex: string): RGB {
  const h = hex.replace("#", "")
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: RGB) {
  return "#" + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")
}

export function mix(a: string, b: string, t: number) {
  const A = toRgb(a)
  const B = toRgb(b)
  return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t])
}

export const shade = (hex: string, t: number) => mix(hex, "#1c1a17", t)
export const tint = (hex: string, t: number) => mix(hex, "#fbf8f2", t)

export function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Wool colour names used in two-tone colourways ("Ecru / Night Blue"). */
const NAMED: Record<string, string> = {
  oat: "#d9ccb4",
  ecru: "#ede6d6",
  "undyed ecru": "#ede6d6",
  fog: "#b9b8b0",
  "fog grey": "#b9b8b0",
  charcoal: "#3e3d3b",
  moss: "#6b7358",
  juniper: "#3f5245",
  rust: "#a45a3a",
  rye: "#b08a5a",
  "night blue": "#2f3a4d",
  plum: "#7a5a66",
  birch: "#cfc6b6",
  lingonberry: "#8e2f36",
  "sea glass": "#a9b8b0",
  baltic: "#5d7488",
  "baltic blue": "#5d7488",
  honey: "#c99a4b",
}

/**
 * Main and accent tones for a colourway. Two-tone names ("Ecru / Night Blue")
 * give both; stripes get a natural contrast.
 */
export function colourway(name: string, hex: string) {
  const parts = name.split("/").map((s) => s.trim().toLowerCase())
  if (parts.length === 2) {
    return {
      main: NAMED[parts[0]] ?? hex,
      accent: NAMED[parts[1]] ?? shade(hex, 0.5),
      twoTone: true,
      stripes: false,
    }
  }
  const stripes = /stripe/i.test(name)
  const accent = luminance(hex) > 0.4 ? "#3e3d3b" : "#e4dbcb"
  return { main: hex, accent, twoTone: false, stripes }
}

/** A warm backdrop that lets the garment colour stand out. */
export function backdropFor(hex: string) {
  const l = luminance(hex)
  if (l > 0.6) return { top: "#e6ddce", bottom: "#d8ccb8" }
  if (l > 0.35) return { top: "#f1ebe1", bottom: "#e4dac9" }
  return { top: tint(hex, 0.86), bottom: tint(hex, 0.74) }
}

/** CSS background for a colour swatch; two-tone colourways are split diagonally. */
export function swatchBackground(c: { name: string; hex: string }) {
  const cw = colourway(c.name, c.hex)
  return cw.twoTone ? `linear-gradient(135deg, ${cw.main} 50%, ${cw.accent} 50%)` : c.hex
}
