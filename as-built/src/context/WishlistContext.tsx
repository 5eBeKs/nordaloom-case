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

const isUnsynced = (userId: string) => localStorage.getItem(unsyncedKey(userId)) === "1"
const setUnsynced = (userId: string, v: boolean) => store(unsyncedKey(userId), v ? "1" : null)

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const userId = user?.id ?? null
  const [ids, setIds] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  const loadedFor = useRef<string | null | undefined>(undefined)

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
    const pending = readMirror(userId)
    if (pending && isUnsynced(userId)) {
      setIds(pending)
      setReady(true)
      return
    }

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
      const { data, error } = await supabase.from("wishlist_items").select("product_id").eq("user_id", userId).order("created_at", { ascending: false })
      if (cancelled) return
      if (error) {
        const mirror = readMirror(userId)
        if (mirror) setIds(mirror)
        else if (isOnline()) toast.error("We couldn't load your wish list. Please refresh the page.")
        setReady(true)
        return
      }
      setIds(data.map((r) => r.product_id))
      setReady(true)
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
    const sync = async () => {
      if (!isUnsynced(userId)) return
      const local = readMirror(userId) ?? []
      const { data, error } = await supabase.from("wishlist_items").select("product_id").eq("user_id", userId)
      if (error) return
      const server = new Set(data.map((r) => r.product_id))
      const keep = new Set(local)
      const gone = [...server].filter((id) => !keep.has(id))
      const added = local.filter((id) => !server.has(id))
      if (gone.length) await supabase.from("wishlist_items").delete().eq("user_id", userId).in("product_id", gone)
      if (added.length) {
        const { error: insertError } = await supabase
          .from("wishlist_items")
          .upsert(added.map((product_id) => ({ user_id: userId, product_id })), { ignoreDuplicates: true })
        if (insertError && insertError.code !== "23503") return
      }
      setUnsynced(userId, false)
    }
    window.addEventListener("nordaloom:online", sync)
    void sync()
    return () => window.removeEventListener("nordaloom:online", sync)
  }, [userId])

  const has = useCallback((productId: string) => ids.includes(productId), [ids])

  const remove = useCallback(
    (productId: string) => {
      setIds((prev) => prev.filter((id) => id !== productId))
      if (userId && !isOnline()) {
        setUnsynced(userId, true)
        return
      }
      if (userId) {
        void supabase
          .from("wishlist_items")
          .delete()
          .eq("user_id", userId)
          .eq("product_id", productId)
          .then(({ error }) => {
            if (!error) return
            setUnsynced(userId, true)
            if (isOnline()) toast.error("We couldn't update your wish list in your account just now — it's kept on this device.")
          })
      }
    },
    [userId],
  )

  const add = useCallback(
    (productId: string) => {
      setIds((prev) => [productId, ...prev.filter((id) => id !== productId)])
      if (!userId) return
      if (!isOnline()) {
        setUnsynced(userId, true)
        return
      }
      void supabase
        .from("wishlist_items")
        .insert({ user_id: userId, product_id: productId })
        .then(({ error }) => {
          if (!error || error.code === "23505") return
          setIds((prev) => prev.filter((id) => id !== productId))
          toast.error(error.message.includes("wishlist_full") ? "Your wish list is full — remove a few pieces first." : "We couldn't save that. Please try again.")
        })
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
