import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { keepPreviousData, useIsRestoring, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/context/AuthContext"
import type { Colour, Product } from "@/lib/catalogue"
import { isOnline } from "@/lib/connection"

/*
 * Guests keep their bag in localStorage. Signed-in customers keep it in the
 * cart_items table, so it follows them between devices. When a guest signs
 * in, whatever was in their browser bag is merged into their account.
 *
 * Offline: a signed-in customer's bag is also kept on the device, so it opens
 * without a connection and can be changed; the changes are sent when the
 * connection comes back. The copy on the device is shown at once, without
 * waiting for the account's copy, and anything changed meanwhile is kept.
 * What each piece is and costs comes from what the device has already saved
 * of the catalogue whenever the shop can't be asked.
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

/** A piece as the bag needs it: the variant and the product it belongs to. */
type VariantRow = {
  id: string
  colour: string
  size: string
  stock: number
  price_cents: number | null
  products: CartItem["product"] & { price_cents: number }
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

/**
 * Changes made on this device that the account hasn't got yet (kept across
 * restarts): for each piece changed, the quantity it was left at (0 = taken
 * out). Only these go to the account when the connection is back, so whatever
 * another device did to the bag meanwhile stays.
 */
const unsyncedKey = (userId: string) => `nordaloom.cart.unsynced.${userId}`
function readNotSent(userId: string): Record<string, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(unsyncedKey(userId)) ?? "{}")
    return saved && typeof saved === "object" ? (saved as Record<string, number>) : {}
  } catch {
    return {}
  }
}
const isUnsynced = (userId: string) => Object.keys(readNotSent(userId)).length > 0
function writeNotSent(userId: string, changes: Record<string, number>) {
  try {
    if (Object.keys(changes).length) localStorage.setItem(unsyncedKey(userId), JSON.stringify(changes))
    else localStorage.removeItem(unsyncedKey(userId))
  } catch {
    // Ignore.
  }
}
const notSent = (userId: string, variantId: string, quantity: number) => writeNotSent(userId, { ...readNotSent(userId), [variantId]: quantity })

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
  const restoring = useIsRestoring()
  // Changed on this device since the account's copy was asked for.
  const touched = useRef(false)
  // Changes are saved to the account one after another, in the order they were made.
  const saves = useRef<Promise<void>>(Promise.resolve())

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
    const mirror = readMirror(userId)
    if (mirror && isUnsynced(userId)) {
      setLines(mirror)
      setReady(true)
      return
    }

    // The copy on this device is shown straight away (the bag opens, and can be
    // changed, without waiting for a connection); the account's copy replaces
    // it when it arrives.
    if (mirror) {
      setLines(mirror)
      setReady(true)
    }
    let cancelled = false
    ;(async () => {
      for (;;) {
        touched.current = false
        const { data, error } = await supabase.from("cart_items").select("variant_id, quantity").eq("user_id", userId)
        if (cancelled) return
        if (error) {
          // Offline (or the shop can't be reached): the copy on this device stays, with anything added since.
          if (!mirror && isOnline()) toast.error("We couldn't load your bag. Please refresh the page.")
          setReady(true)
          return
        }
        // Changed on this device while the account's copy was on its way.
        // Not sent yet (no connection at the time): the device's bag is kept, and sent when the connection is back.
        if (isUnsynced(userId)) {
          setReady(true)
          return
        }
        // Sent: ask again, so the answer includes it.
        if (touched.current) {
          await saves.current
          continue
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
        return
      }
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
    // Still this person's screen: a sync that finishes after they signed out writes nothing.
    let active = true
    const sync = async () => {
      const changes = readNotSent(userId)
      const changed = Object.keys(changes)
      if (changed.length === 0) return
      let kept = changed.filter((id) => changes[id] > 0)
      const out = changed.filter((id) => changes[id] <= 0)
      if (kept.length) {
        const put = () => supabase.from("cart_items").upsert(kept.map((id) => ({ user_id: userId, variant_id: id, quantity: changes[id] })))
        let { error } = await put()
        if (error?.code === "23503" || error?.code === "42501") {
          // A piece that is no longer sold can't be put in the bag: drop that change and send the rest.
          const { data: still } = await supabase.from("product_variants").select("id").in("id", kept)
          const sold = new Set((still ?? []).map((r) => r.id))
          kept = kept.filter((id) => sold.has(id))
          if (!active) return
          writeNotSent(userId, Object.fromEntries(Object.entries(readNotSent(userId)).filter(([id, q]) => q <= 0 || sold.has(id))))
          error = kept.length ? (await put()).error : null
        }
        if (error) return
      }
      if (out.length) {
        const { error } = await supabase.from("cart_items").delete().eq("user_id", userId).in("variant_id", out)
        if (error) return
      }
      // Sent. (Anything changed again while this was on its way stays marked.)
      const now = readNotSent(userId)
      for (const id of changed) if (now[id] === changes[id]) delete now[id]
      writeNotSent(userId, now)
      // The account's bag as it is now: this device's changes and whatever other devices did.
      const { data, error } = await supabase.from("cart_items").select("variant_id, quantity").eq("user_id", userId)
      if (!active) return
      if (!error && !isUnsynced(userId)) setLines(data.map((r) => ({ variantId: r.variant_id, quantity: r.quantity })))
      void queryClient.invalidateQueries({ queryKey: ["cart-variants"] })
    }
    window.addEventListener("nordaloom:online", sync)
    void sync()
    return () => {
      active = false
      window.removeEventListener("nordaloom:online", sync)
    }
  }, [userId, queryClient])

  const persist = useCallback(
    async (variantId: string, quantity: number) => {
      if (!userId) return
      if (!isOnline()) {
        notSent(userId, variantId, quantity)
        return
      }
      const { error } =
        quantity > 0
          ? await supabase.from("cart_items").upsert({ user_id: userId, variant_id: variantId, quantity })
          : await supabase.from("cart_items").delete().eq("user_id", userId).eq("variant_id", variantId)
      if (error) {
        // Kept on this device either way; sent again when the connection is back.
        notSent(userId, variantId, quantity)
        if (isOnline()) toast.error("We couldn't save your bag to your account just now — it's kept on this device.")
      }
    },
    [userId],
  )

  const ids = useMemo(() => lines.map((l) => l.variantId).sort(), [lines])
  const { data: variants, isPlaceholderData } = useQuery({
    queryKey: ["cart-variants", ids],
    // Not during the moment after signing in or out when the lines on screen are still the last person's.
    enabled: ids.length > 0 && loadedFor.current === userId,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants")
        .select("id, colour, size, stock, price_cents, products(id, slug, name, category_slug, images, colours, price_cents)")
        .in("id", ids)
      if (error) throw error
      return data as unknown as VariantRow[]
    },
  })

  // What the device already has about a piece: earlier answers for the bag, and the saved catalogue.
  const saved = useCallback(
    (variantId: string): VariantRow | undefined => {
      for (const [, rows] of queryClient.getQueriesData<VariantRow[]>({ queryKey: ["cart-variants"] })) {
        const row = rows?.find((r) => r.id === variantId)
        if (row?.products) return row
      }
      const catalogue = [
        ...queryClient.getQueriesData<Product | null>({ queryKey: ["product"] }).map(([, p]) => p),
        ...(queryClient.getQueryData<Product[]>(["products"]) ?? []),
      ]
      for (const p of catalogue) {
        const v = p?.product_variants?.find((x) => x.id === variantId)
        if (p && v) {
          return {
            id: v.id, colour: v.colour, size: v.size, stock: v.stock, price_cents: v.price_cents,
            products: { id: p.id, slug: p.slug, name: p.name, category_slug: p.category_slug, images: p.images, colours: p.colours, price_cents: p.price_cents },
          }
        }
      }
      return undefined
    },
    [queryClient],
  )

  // Drop lines whose product has since been removed from the shop, and say so.
  // The pieces as the shop last answered for them, so one that disappears can still be named.
  const lastSeen = useRef(new Map<string, VariantRow>())
  useEffect(() => {
    if (!variants || isPlaceholderData || !isOnline()) return
    const known = new Set(variants.map((v) => v.id))
    const gone = lines.filter((l) => !known.has(l.variantId))
    for (const v of variants) lastSeen.current.set(v.id, v)
    if (gone.length === 0) return
    const names = [...new Set(gone.map((l) => (lastSeen.current.get(l.variantId) ?? saved(l.variantId))?.products?.name).filter(Boolean))]
    toast(
      names.length
        ? `${names.join(", ")} ${names.length === 1 ? "is" : "are"} no longer sold, so we've taken ${names.length === 1 ? "it" : "them"} out of your bag.`
        : "A piece in your bag is no longer sold, so we've taken it out.",
      { id: "bag-piece-withdrawn", duration: 10_000 },
    )
    setLines((prev) => prev.filter((l) => known.has(l.variantId)))
  }, [variants, isPlaceholderData, lines, saved])

  const items = useMemo<CartItem[]>(() => {
    // Until the shop has answered for exactly this bag (or when it can't be asked), fill in from the device.
    const fresh = variants && !isPlaceholderData ? new Map(variants.map((v) => [v.id, v])) : null
    const byId = new Map((variants ?? []).map((v) => [v.id, v]))
    return lines.flatMap((l) => {
      const v = fresh ? fresh.get(l.variantId) : (byId.get(l.variantId) ?? saved(l.variantId))
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
    // `restoring`: the saved catalogue arrives a moment after the app starts.
  }, [lines, variants, isPlaceholderData, saved, restoring])

  /** Saves a change to the account, after the ones before it. */
  const save = useCallback(
    (variantId: string, quantity: number) => {
      touched.current = true
      saves.current = saves.current.then(() => persist(variantId, quantity))
    },
    [persist],
  )

  const setQuantity = useCallback(
    (variantId: string, quantity: number) => {
      const q = Math.max(0, Math.min(MAX_QTY, quantity))
      setLines((prev) =>
        q === 0 ? prev.filter((l) => l.variantId !== variantId) : prev.map((l) => (l.variantId === variantId ? { ...l, quantity: q } : l)),
      )
      save(variantId, q)
    },
    [save],
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
      save(variantId, q)
    },
    [lines, save],
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
