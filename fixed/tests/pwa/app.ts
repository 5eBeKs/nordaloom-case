// For the checks of the shop as an installed app: waiting for its service worker, going offline, and a small
// file server that can be switched from one build of the shop to the next.
import { readFile } from "node:fs/promises"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { extname, join, normalize } from "node:path"
import { expect, type BrowserContext, type Page } from "@playwright/test"

/** Opens the shop and waits until its service worker is in charge and has saved the files this page used. */
export async function openInstalled(page: Page, path = "/") {
  await page.goto(path)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }))
  })
  // the page hands the worker the list of files it loaded before the worker took over
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 20_000 }).toBeGreaterThan(1)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1500)
}

export const goOffline = (context: BrowserContext) => context.setOffline(true)
export const goOnline = (context: BrowserContext) => context.setOffline(false)

/** True when the shop itself is on screen (its header), not an empty page. */
export const shopIsOpen = (page: Page) => page.getByRole("link", { name: "Nordaloom home" })

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".json": "application/json",
}

/**
 * Serves a build of the shop the way a static host does: files as they are, every other address the app page.
 * `root` can be swapped for a newer build while a browser has the older one open, and the app page can be made slow.
 */
export async function serveBuild(firstRoot: string) {
  let root = firstRoot
  let pageDelay = 0
  let pageCaching = "no-cache"
  let rootRedirect = ""
  const server = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url!, "http://x").pathname))
    if (rootRedirect && req.url === "/") {
      res.writeHead(302, { Location: rootRedirect }).end()
      return
    }
    const isFile = extname(path) !== ""
    try {
      const body = await readFile(join(root, isFile ? path : "index.html"))
      if (!isFile && pageDelay) await new Promise((r) => setTimeout(r, pageDelay))
      res.writeHead(200, { "Content-Type": TYPES[isFile ? extname(path) : ".html"] ?? "application/octet-stream", "Cache-Control": isFile ? "no-cache" : pageCaching }).end(body)
    } catch {
      res.writeHead(404).end("not found")
    }
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    use(next: string) {
      root = next
    },
    slowPage(ms: number) {
      pageDelay = ms
    },
    /** The host sends "/" on somewhere else, as some hosts do (a language, a landing page). */
    redirectRoot(to: string) {
      rootRedirect = to
    },
    /** The host lets browsers keep the app page for a while, as many hosts do by default. */
    letPageBeCached(seconds: number) {
      pageCaching = `max-age=${seconds}`
    },
    close: () => new Promise((r) => server.close(r)),
  }
}
