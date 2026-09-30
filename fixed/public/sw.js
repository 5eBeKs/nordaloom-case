// Nordaloom service worker: lets the shop start quickly and open without a connection.
//
// - Pages: the page this build was installed with, at every address (prices and
//   texts that change come from the shop's data, not from the page). On the dev
//   server: network first, the last copy when offline.
// - The app's own files: each build saves its whole set when it is installed,
//   so the saved page always has the files it needs; they are served from the
//   cache (they never change); everything else from the network first.
// - Product photos: shown from the cache, refreshed in the background.
// - Data (prices, stock, orders) is not cached here: the app keeps what the
//   customer has seen itself, and always asks the shop again when online.
//
// VERSION and BUILD_FILES are filled in when the shop is built (vite.config.ts):
// every build is a new version of this file, so phones that have the shop
// installed notice it, save the new build, drop the old one and offer to refresh.
// On the dev server both keep the values below and files are saved as they are used.

const VERSION = "dev"
const BUILD_FILES = []
const SHELL = `nordaloom-shell-${VERSION}`
const FILES = `nordaloom-files-${VERSION}`
// Photos are the same from one version to the next.
const PHOTOS = "nordaloom-photos-v1"
const MAX_PHOTOS = 400
const PAGE_TIMEOUT_MS = 4000
// The saved copy is matched by address alone. Some hosts answer with "Vary: Origin",
// and the page asks for its script and styles with an Origin header that the copy
// was saved without: without this, nothing saved would ever be found.
const ANY = { ignoreVary: true }

// Asked for past the browser's own cache: a host that lets the page be cached would
// otherwise hand a new version the old page.
const fresh = (path) => new Request(path, { cache: "reload" })

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL)
      const page = await fetch(fresh("/"))
      if (!page.ok) throw new Error("the shop's page could not be fetched")
      // The saved page and the saved files must be the same build. If the host still serves
      // another build's page, this version is not installed now; the browser tries again later.
      const html = await page.clone().text()
      // Every build file the page names must be one of this build's (a script, a stylesheet).
      const named = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
      if (BUILD_FILES.length && (named.length === 0 || named.some((file) => !BUILD_FILES.includes(file)))) {
        throw new Error("the page on the host is not this build's page")
      }
      // Saved as a plain answer: a page reached through a redirect can't be given to the browser as a page.
      await shell.put("/", new Response(html, { status: 200, headers: { "Content-Type": page.headers.get("content-type") ?? "text/html; charset=utf-8" } }))
      await shell.addAll(["/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/favicon.svg"].map(fresh))
      await (await caches.open(FILES)).addAll(BUILD_FILES)
      await self.skipWaiting()
    })(),
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

  // An address of a file (robots.txt, a PDF) is that file, not the app page.
  if (req.mode === "navigate" && !/\.[a-z0-9]+$/i.test(url.pathname)) return event.respondWith(page(req))
  if (isPhoto(url)) return event.respondWith(photo(req, event))
  if (url.origin !== self.location.origin) return // the shop's data and sign-in: always live
  if (isBuildFile(url)) return event.respondWith(cacheFirst(req, FILES))
  event.respondWith(networkFirst(req, FILES))
})

/** Pages: every address in the shop is the same app page. */
async function page(req) {
  const cache = await caches.open(SHELL)
  // A built shop opens with the page it was installed with, at every address: that page and the
  // saved files are one build. (A page from the host, or from the browser's own cache, may belong
  // to another build whose files are not here, or no longer on the host.) A newer build arrives
  // as a new version of this worker, which saves its own page and files and then takes over.
  if (BUILD_FILES.length > 0) {
    const saved = await cache.match("/", ANY)
    if (saved) return saved
  }
  try {
    const res = await withTimeout(fetch(req), PAGE_TIMEOUT_MS)
    // The dev server has no such set, so there the latest page is kept.
    if (BUILD_FILES.length === 0 && res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) cache.put("/", res.clone())
    return res
  } catch {
    return (await cache.match("/", ANY)) ?? new Response(offlinePage(), { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}

async function networkFirst(req, name) {
  const cache = await caches.open(name)
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch {
    // Wherever it was saved (the icon and the manifest are saved with the page).
    const hit = (await cache.match(req, ANY)) ?? (await caches.match(req, ANY))
    if (hit) return hit
    throw new Error("offline")
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(req, ANY)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) cache.put(req, res.clone())
  return res
}

/** Photos: from the cache straight away, refreshed quietly for next time. */
async function photo(req, event) {
  const cache = await caches.open(PHOTOS)
  const hit = await cache.match(req, ANY)
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
            if (!(await cache.match(url.href, ANY))) await cache.put(url.href, await fetch(url.href, { mode: "no-cors" }))
          } else if (url.origin === self.location.origin) {
            const cache = await caches.open(FILES)
            if (!(await cache.match(url.href, ANY))) {
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
