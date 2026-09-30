import { defineConfig } from "@playwright/test"

// tests/browser: the shop in a real browser, on the dev server.
// tests/pwa: the shop as it is installed on a phone: the production build, with its service worker.
// Both use the local Supabase from .env.local (see tests/README.md).
const SHOP = process.env.SHOP_URL ?? "http://localhost:3300"
const APP = process.env.APP_URL ?? "http://localhost:4300"
const port = (url: string) => new URL(url).port

export default defineConfig({
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./tests/browser/setup.ts",
  use: {
    // The Edge already on a Windows machine; any Chromium works (PW_CHANNEL=chrome, or empty for Playwright's own).
    channel: process.env.PW_CHANNEL ?? "msedge",
    viewport: { width: 1280, height: 800 },
    locale: "en-GB",
    timezoneId: "Europe/Riga",
  },
  projects: [
    { name: "shop", testDir: "tests/browser", use: { baseURL: SHOP } },
    { name: "app", testDir: "tests/pwa", use: { baseURL: APP } },
  ],
  webServer: [
    { command: `npm run dev -- --port ${port(SHOP)} --strictPort`, url: SHOP, reuseExistingServer: true },
    { command: `npm run preview -- --port ${port(APP)} --strictPort`, url: APP, reuseExistingServer: true },
  ],
})
