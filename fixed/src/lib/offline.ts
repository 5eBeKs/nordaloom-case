// Keeping what customers have seen on their device, and keeping it fresh.
import { useEffect } from "react"
import { QueryClient, useQueryClient, type Query } from "@tanstack/react-query"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import { supabase } from "@/lib/supabase"
import { isOnline } from "@/lib/connection"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Back online: ask again for whatever is on screen.
      refetchOnReconnect: true,
      retry: 1,
      // Kept for the offline copy; staleness is decided per query. While offline,
      // queries wait (keeping what was saved) instead of failing.
      gcTime: 14 * 24 * 60 * 60_000,
    },
  },
})

/** What is saved on the device: the catalogue and the customer's own things — never admin data. */
const SAVED = new Set([
  "categories",
  "products",
  "product",
  "cart-variants",
  "shop-settings",
  "shipping-rates",
  "reviews",
  "profile",
  "my-orders",
  "order",
  "order-returns",
  "addresses",
  "my-reviewables",
])

export const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: "nordaloom.saved.v1",
  throttleTime: 2000,
})

export const persistOptions = {
  persister,
  maxAge: 14 * 24 * 60 * 60_000,
  // Change when the shape of saved data changes, so old copies are dropped.
  buster: "1",
  dehydrateOptions: {
    shouldDehydrateQuery: (q: Query) => q.state.status === "success" && SAVED.has(String(q.queryKey[0])),
  },
}

/** Queries that belong to one signed-in person: forgotten when they sign out (the bag's pieces say what was in it). */
export const PERSONAL = ["profile", "my-orders", "order", "order-returns", "addresses", "my-reviewables", "cart-variants"]

/**
 * Forgets one person's saved answers: from the app's memory, and from the copy
 * on the device straight away (it is otherwise rewritten a couple of seconds
 * later, and a tab closed in between would leave them there).
 */
export function forgetPersonal(client: QueryClient) {
  for (const key of PERSONAL) client.removeQueries({ queryKey: [key] })
  try {
    const raw = localStorage.getItem("nordaloom.saved.v1")
    if (!raw) return
    const saved = JSON.parse(raw)
    const queries = saved?.clientState?.queries
    if (!Array.isArray(queries)) return
    saved.clientState.queries = queries.filter((q: { queryKey?: unknown[] }) => !PERSONAL.includes(String(q.queryKey?.[0])))
    localStorage.setItem("nordaloom.saved.v1", JSON.stringify(saved))
  } catch {
    // Storage blocked or unreadable: drop the saved copy altogether.
    try {
      localStorage.removeItem("nordaloom.saved.v1")
    } catch {
      // Ignore.
    }
  }
}

/**
 * Prices and stock: reload what's on screen when the owner changes them
 * (live, through Supabase Realtime), when the connection comes back, and when
 * the app comes back to the foreground.
 */
export function useLiveCatalogue() {
  const qc = useQueryClient()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        for (const key of ["products", "product", "cart-variants"]) void qc.invalidateQueries({ queryKey: [key] })
      }, 400)
    }
    const channel = supabase
      .channel("catalogue")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "product_variants" }, refresh)
      .subscribe()
    const onVisible = () => document.visibilityState === "visible" && isOnline() && refresh()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("nordaloom:online", refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("nordaloom:online", refresh)
      void supabase.removeChannel(channel)
    }
  }, [qc])
}
