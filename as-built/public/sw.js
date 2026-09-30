// Nordaloom service worker: lets the shop start quickly and open without a connection.
//
// - Pages: network first (so a price or text change is seen at once), the last
//   copy when offline.
// - The app's own files: fingerprinted build files from the cache (they never
//   change); everything else from the network first, the cache when offline.
// - Product photos: shown from the cache, refreshed in the background.
// - Data (prices, stock, orders) is not cached here: the app keeps what the
//   customer has seen itself, and always asks the shop again when online.

const VERSION = "v1"
const SHELL = `nordaloom-shell-${VERSION}`
const FILES = `nordaloom-files-${VERSION}`
const PHOTOS = `nordaloom-photos-${VERSION}`
const MAX_PHOTOS = 400
const PAGE_TIMEOUT_MS = 4000

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/favicon.svg"]))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL, FILES, PHOTOS]
      for (const key of await caches.keys()) if (key.startsWith("nordaloom-") && !keep.includes(key)) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

const isPhoto = (url) => url.pathname.includes("/storage/v1/object/public/")
const isBuildFile = (url) => url.origin === self.location.origin && url.pathname.startsWith("/assets/")

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.protocol !== "http:" && url.protocol !== "https:") return

  if (req.mode === "navigate") return event.respondWith(page(req))
  if (isPhoto(url)) return event.respondWith(photo(req, event))
  if (url.origin !== self.location.origin) return // the shop's data and sign-in: always live
  if (isBuildFile(url)) return event.respondWith(cacheFirst(req, FILES))
  event.respondWith(networkFirst(req, FILES))
})

/** Pages: every address in the shop is the same app page; keep the latest copy. */
async function page(req) {
  const cache = await caches.open(SHELL)
  try {
    const res = await withTimeout(fetch(req), PAGE_TIMEOUT_MS)
    if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) cache.put("/", res.clone())
    return res
  } catch {
    return (await cache.match("/")) ?? new Response(offlinePage(), { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}

async function networkFirst(req, name) {
  const cache = await caches.open(name)
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch {
    const hit = await cache.match(req)
    if (hit) return hit
    throw new Error("offline")
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) cache.put(req, res.clone())
  return res
}

/** Photos: from the cache straight away, refreshed quietly for next time. */
async function photo(req, event) {
  const cache = await caches.open(PHOTOS)
  const hit = await cache.match(req)
  const refresh = fetch(req)
    .then(async (res) => {
      if (res.ok || res.type === "opaque") {
        await cache.put(req, res.clone())
        trim(cache)
      }
      return res
    })
    .catch(() => undefined)
  if (hit) {
    event.waitUntil(refresh)
    return hit
  }
  return (await refresh) ?? new Response("", { status: 504 })
}

async function trim(cache) {
  const keys = await cache.keys()
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PHOTOS))) await cache.delete(k)
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms)
    promise.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)))
  })
}

// The page tells us what it loaded before this worker was in charge, so those
// files are ready for the first offline start too.
self.addEventListener("message", (event) => {
  const { type, urls } = event.data ?? {}
  if (type !== "cache-urls" || !Array.isArray(urls)) return
  event.waitUntil(
    (async () => {
      for (const u of urls.slice(0, 300)) {
        try {
          const url = new URL(u, self.location.origin)
          if (isPhoto(url)) {
            const cache = await caches.open(PHOTOS)
            if (!(await cache.match(url.href))) await cache.put(url.href, await fetch(url.href, { mode: "no-cors" }))
          } else if (url.origin === self.location.origin) {
            const cache = await caches.open(FILES)
            if (!(await cache.match(url.href))) {
              const res = await fetch(url.href)
              if (res.ok) await cache.put(url.href, res)
            }
          }
        } catch {
          // Skip what can't be fetched now.
        }
      }
    })(),
  )
})

function offlinePage() {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nordaloom</title>
<body style="margin:0;background:#f7f3ec;color:#2b2824;font-family:Georgia,serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px">
<div><p style="font-size:28px;margin:0 0 12px">Nordaloom</p><p style="font-family:system-ui,sans-serif;color:#6e675d;margin:0 0 20px">You're offline, and the shop hasn't been saved on this device yet.<br>Open it once with a connection, and it will open offline next time.</p>
<button onclick="location.reload()" style="font:inherit;font-family:system-ui,sans-serif;border:1px solid #2b2824;background:none;padding:10px 20px">Try again</button></div></body>`
}
