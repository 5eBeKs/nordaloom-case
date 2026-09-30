// Resizes the photos in owner-photos/ to web-sized WebP and uploads them to the
// public "product-images" storage bucket:
//   product photos (sweater-01, hat-03, …) → products/<name>.webp
//   wide-*, making-*                        → site/<name>.webp
// Usage: node scripts/upload-photos.mjs
// Needs the service role key (defaults to the standard local development key).
import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:57321"
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const SRC = fileURLToPath(new URL("../owner-photos/", import.meta.url))

for (const file of readdirSync(SRC).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()) {
  const name = file.replace(/\.[^.]+$/, "")
  const site = /^(wide|making)-/.test(name)
  const body = await sharp(SRC + file)
    .rotate()
    .resize({ width: site ? 2000 : 1100, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()
  const path = `${site ? "site" : "products"}/${name}.webp`
  const res = await fetch(`${API}/storage/v1/object/product-images/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "image/webp", "x-upsert": "true", "Cache-Control": "max-age=31536000" },
    body,
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  console.log(`${path}  ${Math.round(body.length / 1024)} KB`)
}
