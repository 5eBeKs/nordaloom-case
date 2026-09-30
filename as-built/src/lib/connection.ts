// Is the shop reachable? The phone's own "online" flag isn't enough: on a
// train or behind a café's login page it says online while nothing gets
// through. So every request to the shop also tells us whether it worked, and
// while it doesn't, we check again every few seconds.
import { onlineManager } from "@tanstack/react-query"

const URL_ = import.meta.env.VITE_SUPABASE_URL as string
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const RECHECK_MS = 8000

let unreachable = false
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

export const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine) && !unreachable

function changed() {
  listeners.forEach((l) => l())
  if (typeof window !== "undefined") window.dispatchEvent(new Event(isOnline() ? "nordaloom:online" : "nordaloom:offline"))
}

function setReachable(ok: boolean) {
  if (ok === !unreachable) return
  unreachable = !ok
  clearTimeout(timer)
  if (unreachable) recheckSoon()
  changed()
}

function recheckSoon() {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    try {
      const res = await fetch(`${URL_}/auth/v1/health`, { headers: { apikey: KEY }, cache: "no-store" })
      setReachable(res.status < 500)
    } catch {
      /* still unreachable */
    }
    if (unreachable) recheckSoon()
  }, RECHECK_MS)
}

const looksLikeNoConnection = (e: unknown) =>
  e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(String((e as Error)?.message ?? e))

/** fetch for the Supabase client: notes whether the shop could be reached. */
export async function trackedFetch(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const res = await fetch(input, init)
    setReachable(true)
    return res
  } catch (e) {
    if (looksLikeNoConnection(e)) setReachable(false)
    throw e
  }
}

export function subscribeConnection(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    // The phone says it's back: believe it, and let the next request confirm.
    unreachable = false
    changed()
  })
  window.addEventListener("offline", changed)
  // Queries follow this rather than the phone's flag alone.
  onlineManager.setEventListener((setOnline) => subscribeConnection(() => setOnline(isOnline())))
  onlineManager.setOnline(isOnline())
}
