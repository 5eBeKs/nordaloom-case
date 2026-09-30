import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"
import type { Colour } from "@/lib/catalogue"
import { isOnline } from "@/lib/connection"

/*
 * Guests keep their bag in localStorage. Signed-in customers keep it in the
 * cart_items table, so it follows them between devices. When a guest signs
 * in, whatever was in their browser bag is merged into their account.
 *
 * Offline: a signed-in customer's bag is also kept on the device, so it opens
 * without a connection and can be changed; the changes are sent when the
 * connection comes back.
 */

const STORAGE_KEY = "nordaloom.cart.v1"
const DISCOUNT_KEY = "nordaloom.discount.v1"
export const MAX_QTY = 20

type Line = { variantId: string; quantity: number }

export type CartItem = {
  variantId: string
  quantity: number
  colour: string
  size: string
  stock: number
  unitPrice: number
  lineTotal: number
  product: {
    id: string
    slug: string
    name: string
    category_slug: string
    images: string[]
    colours: Colour[]
  }
}

type CartState = {
  items: CartItem[]
  count: number
  subtotal: number
  /** False until the bag has been restored (and synced after sign-in). */
  ready: boolean
  add: (variantId: string, quantity: number, stock: number) => void
  setQuantity: (variantId: string, quantity: number) => void
  remove: (variantId: string) => void
  /** Empties the bag after an order (the server has already cleared a signed-in bag). */
  clearAfterOrder: () => void
  /** Re-reads stock and prices for the items in the bag. */
  refresh: () => Promise<void>
  /** The discount code entered in the bag (checked live; see useDiscount). */
  discountCode: string | null
  setDiscountCode: (code: string | null) => void
  open: boolean
  setOpen: (open: boolean) => void
}

const CartContext = createContext<CartState | null>(null)

function readLocal(): Line[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((l) => typeof l?.variantId === "string" && Number.isInteger(l?.quantity) && l.quantity > 0)
      : []
  } catch {
    return []
  }
}

function writeLocal(lines: Line[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
}

const mirrorKey = (userId: string) => `nordaloom.cart.account.${userId}`

function readMirror(userId: string): Line[] | null {
  try {
    const raw = localStorage.getItem(mirrorKey(userId))
    return raw ? (JSON.parse(raw) as Line[]) : null
  } catch {
    return null
  }
}

/** Changes made on this device that the account hasn't got yet (kept across restarts). */
const unsyncedKey = (userId: string) => `nordaloom.cart.unsynced.${userId}`
const isUnsynced = (userId: string) => localStorage.getItem(unsyncedKey(userId)) === "1"
function setUnsynced(userId: string, v: boolean) {
  try {
    if (v) localStorage.setItem(unsyncedKey(userId), "1")
    else localStorage.removeItem(unsyncedKey(userId))
  } catch {
    // Ignore.
  }
}

function writeMirror(userId: string, lines: Line[]) {
  try {
    localStorage.setItem(mirrorKey(userId), JSON.stringify(lines))
  } catch {
    // Storage full: the bag still lives in the account.
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const userId = user?.id ?? null
  const [lines, setLines] = useState<Line[]>([])
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(false)
  const [discountCode, setDiscountCodeState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISCOUNT_KEY)
    } catch {
      return null
    }
  })
  const setDiscountCode = useCallback((code: string | null) => {
    const c = code ? code.trim().toUpperCase() : null
    setDiscountCodeState(c)
    try {
      if (c) localStorage.setItem(DISCOUNT_KEY, c)
      else localStorage.removeItem(DISCOUNT_KEY)
    } catch {
      // Private mode: the code simply won't survive a reload.
    }
  }, [])
  const loadedFor = useRef<string | null | undefined>(undefined)
  const queryClient = useQueryClient()

  // Restore the bag whenever the signed-in user changes.
  useEffect(() => {
    if (authLoading || loadedFor.current === userId) return
    loadedFor.current = userId
    setReady(false)

    if (!userId) {
      setLines(readLocal())
      setReady(true)
      return
    }

    // Changed offline last time and not sent yet: this device's bag is the one to keep.
    const pending = readMirror(userId)
    if (pending && isUnsynced(userId)) {
      setLines(pending)
      setReady(true)
      return
    }

    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from("cart_items").select("variant_id, quantity").eq("user_id", userId)
      if (error) {
        // Offline (or the shop can't be reached): use the copy on this device.
        const mirror = readMirror(userId)
        if (cancelled) return
        if (mirror) {
          setLines(mirror)
          setReady(true)
          return
        }
        if (isOnline()) toast.error("We couldn't load your bag. Please refresh the page.")
        setReady(true)
        return
      }
      const merged = new Map<string, number>(data.map((r) => [r.variant_id, r.quantity]))
      const local = readLocal()
      if (local.length > 0) {
        for (const l of local) merged.set(l.variantId, Math.min(MAX_QTY, (merged.get(l.variantId) ?? 0) + l.quantity))
        const { error: upsertError } = await supabase.from("cart_items").upsert(
          local.map((l) => ({ user_id: userId, variant_id: l.variantId, quantity: merged.get(l.variantId)! })),
        )
        if (!upsertError) writeLocal([])
      }
      if (cancelled) return
      setLines([...merged].map(([variantId, quantity]) => ({ variantId, quantity })))
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [userId, authLoading])

  // Keep the copy on this device in step (guests: their only copy).
  useEffect(() => {
    if (!ready) return
    if (userId) writeMirror(userId, lines)
    else writeLocal(lines)
  }, [lines, ready, userId])

  // Back online: send what changed while offline (the device's bag wins).
  useEffect(() => {
    if (!userId) return
    const sync = async () => {
      if (!isUnsynced(userId)) return
      const local = readMirror(userId) ?? []
      const { data, error } = await supabase.from("cart_items").select("variant_id").eq("user_id", userId)
      if (error) return
      const keep = new Set(local.map((l) => l.variantId))
      const gone = data.map((r) => r.variant_id).filter((id) => !keep.has(id))
      if (gone.length) await supabase.from("cart_items").delete().eq("user_id", userId).in("variant_id", gone)
      if (local.length) {
        const { error: upsertError } = await supabase
          .from("cart_items")
          .upsert(local.map((l) => ({ user_id: userId, variant_id: l.variantId, quantity: l.quantity })))
        if (upsertError) return
      }
      setUnsynced(userId, false)
      void queryClient.invalidateQueries({ queryKey: ["cart-variants"] })
    }
    window.addEventListener("nordaloom:online", sync)
    void sync()
    return () => window.removeEventListener("nordaloom:online", sync)
  }, [userId, queryClient])

  const persist = useCallback(
    async (variantId: string, quantity: number) => {
      if (!userId) return
      if (!isOnline()) {
        setUnsynced(userId, true)
        return
      }
      const { error } =
        quantity > 0
          ? await supabase.from("cart_items").upsert({ user_id: userId, variant_id: variantId, quantity })
          : await supabase.from("cart_items").delete().eq("user_id", userId).eq("variant_id", variantId)
      if (error) {
        // Kept on this device either way; sent again when the connection is back.
        setUnsynced(userId, true)
        if (isOnline()) toast.error("We couldn't save your bag to your account just now — it's kept on this device.")
      }
    },
    [userId],
  )

  const ids = useMemo(() => lines.map((l) => l.variantId).sort(), [lines])
  const { data: variants, isPlaceholderData } = useQuery({
    queryKey: ["cart-variants", ids],
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants")
        .select("id, colour, size, stock, price_cents, products(id, slug, name, category_slug, images, colours, price_cents)")
        .in("id", ids)
      if (error) throw error
      return data as unknown as Array<{
        id: string
        colour: string
        size: string
        stock: number
        price_cents: number | null
        products: CartItem["product"] & { price_cents: number }
      }>
    },
  })

  // Drop lines whose product has since been removed from the shop.
  useEffect(() => {
    if (!variants || isPlaceholderData || !isOnline()) return
    const known = new Set(variants.map((v) => v.id))
    if (lines.some((l) => !known.has(l.variantId))) {
      setLines((prev) => prev.filter((l) => known.has(l.variantId)))
    }
  }, [variants, isPlaceholderData, lines])

  const items = useMemo<CartItem[]>(() => {
    if (!variants) return []
    const byId = new Map(variants.map((v) => [v.id, v]))
    return lines.flatMap((l) => {
      const v = byId.get(l.variantId)
      if (!v || !v.products) return []
      const unitPrice = v.price_cents ?? v.products.price_cents
      return [
        {
          variantId: l.variantId,
          quantity: l.quantity,
          colour: v.colour,
          size: v.size,
          stock: v.stock,
          unitPrice,
          lineTotal: unitPrice * l.quantity,
          product: v.products,
        },
      ]
    })
  }, [lines, variants])

  const setQuantity = useCallback(
    (variantId: string, quantity: number) => {
      const q = Math.max(0, Math.min(MAX_QTY, quantity))
      setLines((prev) =>
        q === 0 ? prev.filter((l) => l.variantId !== variantId) : prev.map((l) => (l.variantId === variantId ? { ...l, quantity: q } : l)),
      )
      void persist(variantId, q)
    },
    [persist],
  )

  const add = useCallback(
    (variantId: string, quantity: number, stock: number) => {
      const current = lines.find((l) => l.variantId === variantId)?.quantity ?? 0
      const q = Math.min(MAX_QTY, stock, current + quantity)
      setLines((prev) =>
        prev.some((l) => l.variantId === variantId)
          ? prev.map((l) => (l.variantId === variantId ? { ...l, quantity: q } : l))
          : [...prev, { variantId, quantity: q }],
      )
      void persist(variantId, q)
    },
    [lines, persist],
  )

  const remove = useCallback((variantId: string) => setQuantity(variantId, 0), [setQuantity])

  const clearAfterOrder = useCallback(() => {
    setLines([])
    setDiscountCode(null)
  }, [setDiscountCode])

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["cart-variants"] }),
    [queryClient],
  )

  const value: CartState = {
    items,
    count: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: items.reduce((s, i) => s + i.lineTotal, 0),
    ready,
    add,
    setQuantity,
    remove,
    clearAfterOrder,
    discountCode,
    setDiscountCode,
    refresh,
    open,
    setOpen,
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error("useCart must be used inside CartProvider")
  return ctx
}
