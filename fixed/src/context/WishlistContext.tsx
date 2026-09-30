import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"
import { isOnline } from "@/lib/connection"

/*
 * The wish list works like the bag: guests keep it in the browser, signed-in
 * customers in their account (wishlist_items). Signing in moves the browser
 * list into the account.
 *
 * Offline: a signed-in customer's list is also kept on the device, can be
 * changed, and is sent to the account when the connection comes back.
 */

const STORAGE_KEY = "nordaloom.wishlist.v1"

type WishlistState = {
  /** Product ids, most recently saved first. */
  ids: string[]
  count: number
  ready: boolean
  has: (productId: string) => boolean
  toggle: (productId: string, name?: string) => void
  remove: (productId: string) => void
}

const WishlistContext = createContext<WishlistState | null>(null)

function readLocal(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}

function writeLocal(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Private mode: the list lasts until the tab closes.
  }
}

const mirrorKey = (userId: string) => `nordaloom.wishlist.account.${userId}`
const unsyncedKey = (userId: string) => `nordaloom.wishlist.unsynced.${userId}`

function readMirror(userId: string): string[] | null {
  try {
    const raw = localStorage.getItem(mirrorKey(userId))
    return raw ? (JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Ignore.
  }
}

/**
 * Changes made on this device that the account hasn't got yet: for each piece,
 * whether it was saved (1) or taken off (0). Only these go to the account when
 * the connection is back, so what other devices did to the list stays.
 */
function readNotSent(userId: string): Record<string, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(unsyncedKey(userId)) ?? "{}")
    return saved && typeof saved === "object" ? (saved as Record<string, number>) : {}
  } catch {
    return {}
  }
}
const isUnsynced = (userId: string) => Object.keys(readNotSent(userId)).length > 0
const writeNotSent = (userId: string, changes: Record<string, number>) => store(unsyncedKey(userId), Object.keys(changes).length ? JSON.stringify(changes) : null)
const notSent = (userId: string, productId: string, saved: boolean) => writeNotSent(userId, { ...readNotSent(userId), [productId]: saved ? 1 : 0 })

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const userId = user?.id ?? null
  const [ids, setIds] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  const loadedFor = useRef<string | null | undefined>(undefined)
  // Changed on this device since the account's list was asked for.
  const touched = useRef(false)
  // Changes are saved to the account one after another; the list is asked for again once they are in.
  const saves = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (authLoading || loadedFor.current === userId) return
    loadedFor.current = userId
    setReady(false)

    if (!userId) {
      setIds(readLocal())
      setReady(true)
      return
    }

    // Changed offline last time and not sent yet: keep this device's list.
    const mirror = readMirror(userId)
    if (mirror && isUnsynced(userId)) {
      setIds(mirror)
      setReady(true)
      return
    }

    // The copy on this device is shown straight away; the account's list replaces it when it arrives.
    if (mirror) {
      setIds(mirror)
      setReady(true)
    }
    touched.current = false
    let cancelled = false
    ;(async () => {
      const local = readLocal()
      if (local.length > 0) {
        const { error } = await supabase
          .from("wishlist_items")
          .upsert(local.map((product_id) => ({ user_id: userId, product_id })), { ignoreDuplicates: true })
        // Pieces removed from the shop since can't be saved; keep going without them.
        if (!error || error.code === "23503") writeLocal([])
      }
      for (;;) {
        touched.current = false
        const { data, error } = await supabase.from("wishlist_items").select("product_id").eq("user_id", userId).order("created_at", { ascending: false })
        if (cancelled) return
        if (error) {
          // Offline (or the shop can't be reached): the list on this device stays, with anything changed since.
          if (!mirror && isOnline()) toast.error("We couldn't load your wish list. Please refresh the page.")
          setReady(true)
          return
        }
        // Changed on this device meanwhile and not sent (no connection at the time): this device's
        // list is kept, and sent when the connection is back.
        if (isUnsynced(userId)) {
          setReady(true)
          return
        }
        // Changed and sent: ask again, so the account's answer includes it.
        if (touched.current) {
          await saves.current
          continue
        }
        setIds(data.map((r) => r.product_id))
        setReady(true)
        return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, authLoading])

  useEffect(() => {
    if (!ready) return
    if (userId) store(mirrorKey(userId), JSON.stringify(ids))
    else writeLocal(ids)
  }, [ids, ready, userId])

  // Back online: send what changed while offline (this device's list wins).
  useEffect(() => {
    if (!userId) return
    // Still this person's screen: a sync that finishes after they signed out writes nothing.
    let active = true
    const sync = async () => {
      const changes = readNotSent(userId)
      const changed = Object.keys(changes)
      if (changed.length === 0) return
      let added = changed.filter((id) => changes[id] === 1)
      const removed = changed.filter((id) => changes[id] === 0)
      if (added.length) {
        const put = () => supabase.from("wishlist_items").upsert(added.map((product_id) => ({ user_id: userId, product_id })), { ignoreDuplicates: true })
        let { error } = await put()
        if (error?.code === "23503" || error?.code === "42501") {
          // A piece removed from the shop since can't be saved: save the others.
          const { data: still } = await supabase.from("products").select("id").in("id", added)
          const sold = new Set((still ?? []).map((r) => r.id))
          added = added.filter((id) => sold.has(id))
          error = added.length ? (await put()).error : null
        }
        if (error) return
      }
      if (removed.length) {
        const { error } = await supabase.from("wishlist_items").delete().eq("user_id", userId).in("product_id", removed)
        if (error) return
      }
      const now = readNotSent(userId)
      for (const id of changed) if (now[id] === changes[id]) delete now[id]
      writeNotSent(userId, now)
      // The account's list as it is now: this device's changes and whatever other devices did.
      const { data, error } = await supabase.from("wishlist_items").select("product_id").eq("user_id", userId).order("created_at", { ascending: false })
      if (!active) return
      if (!error && !isUnsynced(userId)) setIds(data.map((r) => r.product_id))
    }
    window.addEventListener("nordaloom:online", sync)
    void sync()
    return () => {
      active = false
      window.removeEventListener("nordaloom:online", sync)
    }
  }, [userId])

  const has = useCallback((productId: string) => ids.includes(productId), [ids])

  const remove = useCallback(
    (productId: string) => {
      touched.current = true
      setIds((prev) => prev.filter((id) => id !== productId))
      if (userId && !isOnline()) {
        notSent(userId, productId, false)
        return
      }
      if (userId) {
        saves.current = saves.current.then(() =>
          supabase
            .from("wishlist_items")
            .delete()
            .eq("user_id", userId)
            .eq("product_id", productId)
            .then(({ error }) => {
              if (!error) return
              notSent(userId, productId, false)
              if (isOnline()) toast.error("We couldn't update your wish list in your account just now — it's kept on this device.")
            }),
        )
      }
    },
    [userId],
  )

  const add = useCallback(
    (productId: string) => {
      touched.current = true
      setIds((prev) => [productId, ...prev.filter((id) => id !== productId)])
      if (!userId) return
      if (!isOnline()) {
        notSent(userId, productId, true)
        return
      }
      saves.current = saves.current.then(() =>
        supabase
          .from("wishlist_items")
          .insert({ user_id: userId, product_id: productId })
          .then(({ error }) => {
          if (!error || error.code === "23505") return
          // No answer at all (the connection dropped): kept on this device, sent when it's back.
          if (!isOnline()) {
            notSent(userId, productId, true)
            return
          }
          setIds((prev) => prev.filter((id) => id !== productId))
            toast.error(error.message.includes("wishlist_full") ? "Your wish list is full — remove a few pieces first." : "We couldn't save that. Please try again.")
          }),
      )
    },
    [userId],
  )

  const toggle = useCallback(
    (productId: string, name?: string) => {
      if (ids.includes(productId)) {
        remove(productId)
        toast(name ? `${name} removed from your wish list.` : "Removed from your wish list.", {
          action: { label: "Undo", onClick: () => add(productId) },
        })
        return
      }
      add(productId)
      toast(name ? `${name} saved to your wish list.` : "Saved to your wish list.", {
        description: userId ? undefined : "Sign in to keep it on every device.",
      })
    },
    [ids, add, remove, userId],
  )

  return (
    <WishlistContext.Provider value={{ ids, count: ids.length, ready, has, toggle, remove }}>{children}</WishlistContext.Provider>
  )
}

export function useWishlist() {
  const ctx = useContext(WishlistContext)
  if (!ctx) throw new Error("useWishlist must be used inside WishlistProvider")
  return ctx
}
