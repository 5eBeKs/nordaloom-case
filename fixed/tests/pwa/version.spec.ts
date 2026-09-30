// A phone that has the shop installed gets the next version: it is offered while the app is open, the saved copy
// is replaced, and files of the old version do not pile up. Two real builds of the shop are served in turn.
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { build } from "vite"
import { openInstalled, serveBuild, shopIsOpen } from "./app"

const A = resolve(".tmp/build-a")
const B = resolve(".tmp/build-b")
let host: Awaited<ReturnType<typeof serveBuild>>

test.beforeAll(async () => {
  test.setTimeout(300_000)
  await build({ logLevel: "silent", build: { outDir: A, emptyOutDir: true } })
  // the next version: the same shop with one line changed, as after any edit
  await build({
    logLevel: "silent",
    build: { outDir: B, emptyOutDir: true },
    plugins: [{
      name: "a-later-version",
      transform(code, id) {
        if (id.split("\\").join("/").endsWith("/src/main.tsx")) return `${code}\nconsole.info("a later version of the shop")\n`
      },
    }],
  })
})
test.beforeEach(async () => {
  host = await serveBuild(A)
})
test.afterEach(() => host.close())

/** The app's main script, as named in a build's page. */
const scriptOf = (dir: string) => readFileSync(join(dir, "index.html"), "utf8").match(/src="(\/assets\/index-[^"]+\.js)"/)![1]
const running = (page: Page) => page.evaluate(() => new URL(document.querySelector<HTMLScriptElement>('script[type="module"][src]')!.src).pathname)

test("the two builds differ, as two versions do", () => {
  expect(scriptOf(A)).not.toBe(scriptOf(B))
})

test("an open shop is offered the new version, and the old version's files are dropped", async ({ page }) => {
  await openInstalled(page, `${host.url}/`)
  await page.reload()
  await expect(shopIsOpen(page)).toBeVisible()
  expect(await running(page)).toBe(scriptOf(A))

  host.use(B)
  // the open app looks for a newer version every hour; here, now
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update())
  // as built: the worker file is the same in every build, so an open app never hears about a new version
  await expect(page.getByText("A new version of the shop is ready.")).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "Refresh" }).click()
  await expect.poll(() => running(page)).toBe(scriptOf(B))

  const saved = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname)
    return urls
  })
  expect(saved.filter((u) => u === scriptOf(A)), "the old version's script is still saved on the device").toEqual([])
})

test("on a slow connection the saved shop opens at once, and the new version is there the next time", async ({ page }) => {
  await openInstalled(page, `${host.url}/`)
  await page.reload()
  expect(await running(page)).toBe(scriptOf(A))

  host.use(B)
  // the page itself now takes 6 seconds to arrive: longer than the app waits before using its saved copy
  host.slowPage(6000)
  await page.reload()
  await expect(shopIsOpen(page)).toBeVisible()
  // time for the slow answer to finish arriving in the background
  await page.waitForTimeout(9000)
  await page.reload()
  await expect(shopIsOpen(page)).toBeVisible()
  // as built: the saved copy is never replaced while the connection stays slow, so the old version keeps coming back
  expect(await running(page), "the version that opens on the second slow start").toBe(scriptOf(B))
})

test("on a host that lets the page be cached, the new version still opens without a connection", async ({ page, context }) => {
  host.letPageBeCached(600)
  await openInstalled(page, `${host.url}/`)
  // the addresses the app is opened at from the home screen and from a bookmark: the browser keeps them too
  await page.goto(`${host.url}/?source=app`)
  await page.goto(`${host.url}/shop`)
  await page.goto(`${host.url}/`)
  expect(await running(page)).toBe(scriptOf(A))

  host.use(B)
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update())
  await expect(page.getByText("A new version of the shop is ready.")).toBeVisible({ timeout: 30_000 })
  // after the second fix: an empty page at every address but "/" (the old page from the browser's cache,
  // asking for a script the new deploy no longer has)
  for (const address of ["/?source=app", "/shop"]) {
    await page.goto(`${host.url}${address}`)
    await expect(shopIsOpen(page), `the shop at ${address} after the update`).toBeVisible()
    expect(await running(page)).toBe(scriptOf(B))
  }
  // the phone loses its connection before the customer presses Refresh
  await context.setOffline(true)
  await page.reload()
  // after the first fix: the new version had saved the old page (from the browser's own cache) next to the
  // new files, and the shop was an empty page offline until the next update
  await expect(shopIsOpen(page)).toBeVisible()
  expect(await running(page)).toBe(scriptOf(B))
})

test("a tab that has been open since the very first visit is told about a new version too", async ({ page }) => {
  await openInstalled(page, `${host.url}/`)
  // no reload: this tab was opened before any version of the shop was saved
  host.use(B)
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update())
  await expect(page.getByText("A new version of the shop is ready.")).toBeVisible({ timeout: 30_000 })
})

test("on a host that sends / on somewhere else, the shop still opens at every address, also offline", async ({ page, context }) => {
  host.redirectRoot("/home")
  await openInstalled(page, `${host.url}/home`)
  await page.reload()
  // after the third fix: every address but the one redirected to failed, online and offline
  for (const address of ["/shop", "/?source=app"]) {
    await page.goto(`${host.url}${address}`)
    await expect(shopIsOpen(page), `the shop at ${address}`).toBeVisible()
  }
  await context.setOffline(true)
  await page.goto(`${host.url}/shop`)
  await expect(shopIsOpen(page), "the shop offline").toBeVisible()
})

test("the address of a file gets the file, not the app page", async ({ page }) => {
  await openInstalled(page, `${host.url}/`)
  await page.reload()
  await page.goto(`${host.url}/manifest.webmanifest`)
  expect(await page.locator("body").innerText()).toContain('"short_name"')
})
