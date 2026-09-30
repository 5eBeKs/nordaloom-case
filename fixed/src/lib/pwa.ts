// The shop as an app on the phone: the service worker, online/offline, install.
import { useEffect, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { isOnline, subscribeConnection } from "@/lib/connection"

// ---------------------------------------------------------------------------
// Service worker
// ---------------------------------------------------------------------------

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return
  // Whether a worker is already in charge of this tab. The first time one takes charge
  // (the very first visit) is not a new version; every time after that is.
  let inCharge = !!navigator.serviceWorker.controller
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready
      // Files this page loaded before the worker was in charge: save them for offline too.
      const urls = [location.origin + "/", ...performance.getEntriesByType("resource").map((e) => e.name)]
      reg.active?.postMessage({ type: "cache-urls", urls })
      // Look for a newer version now and then (the app may stay open for days).
      setInterval(() => reg.update().catch(() => undefined), 60 * 60_000)
    } catch {
      // Not available (e.g. private mode): the shop simply works online only.
    }
  })
  // A new version took over: offer to reload rather than doing it mid-checkout.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!inCharge) {
      inCharge = true
      return
    }
    toast("A new version of the shop is ready.", { id: "new-version", duration: Infinity, action: { label: "Refresh", onClick: () => location.reload() } })
  })
}

// ---------------------------------------------------------------------------
// Online or not
// ---------------------------------------------------------------------------

/** True while the shop can be reached (the phone is online and requests get through). */
export function useOnline() {
  return useSyncExternalStore(subscribeConnection, isOnline, () => true)
}

/** Runs `fn` each time the connection comes back. */
export function useOnReconnect(fn: () => void) {
  useEffect(() => {
    window.addEventListener("nordaloom:online", fn)
    return () => window.removeEventListener("nordaloom:online", fn)
  }, [fn])
}

// ---------------------------------------------------------------------------
// Putting the shop on the home screen
// ---------------------------------------------------------------------------

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault() // we offer it ourselves, quietly
    deferred = e as InstallEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

/**
 * How the shop can be installed here: "prompt" (Android/Chrome, one tap),
 * "ios" (Share → Add to Home Screen), or null (already installed / not possible).
 */
export function useInstall() {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((n) => n + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  if (typeof window === "undefined" || isStandalone()) return { how: null as null, install: async () => false }
  if (deferred) {
    return {
      how: "prompt" as const,
      install: async () => {
        const e = deferred
        if (!e) return false
        await e.prompt()
        const { outcome } = await e.userChoice
        deferred = null
        listeners.forEach((l) => l())
        return outcome === "accepted"
      },
    }
  }
  if (isIos()) return { how: "ios" as const, install: async () => false }
  return { how: null as null, install: async () => false }
}
