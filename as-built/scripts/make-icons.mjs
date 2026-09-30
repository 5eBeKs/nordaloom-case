// Draws the app icons (the knit-stitch mark from the logo on charcoal) into public/icons/.
// Usage: node scripts/make-icons.mjs
import sharp from "sharp"

const INK = "#2b2824"
const WOOL = "#f7f3ec"

/** The mark, scaled to take `share` of the icon's width. */
function svg(size, share) {
  const w = size * share
  const h = w * (20 / 24)
  const x = (size - w) / 2
  const y = (size - h) / 2
  const k = w / 24
  const stroke = 1.8 * k
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${INK}"/>
  <g transform="translate(${x} ${y}) scale(${k})" fill="none" stroke="${WOOL}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${stroke / k}">
    <path d="M2 3 L6 10 L10 3 L14 10 L18 3 L22 10"/>
    <path d="M2 10 L6 17 L10 10 L14 17 L18 10 L22 17" opacity="0.5"/>
  </g>
</svg>`
}

const icons = [
  ["icon-192.png", 192, 0.56],
  ["icon-512.png", 512, 0.56],
  // Android may crop "maskable" icons to a circle: keep the mark well inside.
  ["icon-maskable-512.png", 512, 0.44],
  ["apple-touch-icon.png", 180, 0.56],
]
for (const [name, size, share] of icons) {
  await sharp(Buffer.from(svg(size, share))).png().toFile(`public/icons/${name}`)
  console.log("wrote", name)
}
