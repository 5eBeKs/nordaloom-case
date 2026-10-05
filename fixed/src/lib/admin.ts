import { useQuery } from "@tanstack/react-query"
import { DEMO_OFF, demoRefused } from "@/lib/demo"
import { shopDate } from "@/lib/format"
import { supabase } from "@/lib/supabase"
import type { Order, OrderItem, OrderStatus } from "@/lib/checkout"
import type { ReturnRequest, ReturnReason, ReturnStatus, SavedAddress } from "@/lib/account"
import type { Colour, Product, Variant } from "@/lib/catalogue"

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type Dashboard = {
  daily: { date: string; sales_cents: number; orders: number }[]
  monthly: { month: string; sales_cents: number; orders: number }[]
  last30: { sales_cents: number; orders: number }
  previous30: { sales_cents: number; orders: number }
  all_time: { sales_cents: number; orders: number }
  refunded_30d_cents: number
  best_sellers: { product_slug: string; product_name: string; product_image: string | null; pieces: number; sales_cents: number }[]
  low_stock: { product_id: string; product_name: string; product_image: string | null; variant_id: string; colour: string; size: string; stock: number }[]
  low_stock_count: number
  low_stock_threshold: number
  waiting: { to_ship: number; awaiting_payment: number; in_transit: number; returns_to_decide: number; returns_to_refund: number }
  recent_orders: { order_number: string; full_name: string; total_cents: number; status: OrderStatus; created_at: string }[]
}

export function useDashboard() {
  return useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_dashboard")
      if (error) throw error
      return data as Dashboard
    },
  })
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type AdminOrder = Omit<Order, "items" | "bank" | "return_until" | "is_account_order"> & {
  user_id: string | null
  stripe_payment_intent: string | null
  stripe_livemode: boolean | null
  order_items: OrderItem[]
}

export const ORDERS_PAGE_SIZE = 25

/** Characters that would break a PostgREST filter expression. */
const clean = (q: string) => q.replace(/[,()*%\\]/g, " ").trim()

export function useAdminOrders(search: string, status: OrderStatus | "all", page: number) {
  return useQuery({
    queryKey: ["admin-orders", search, status, page],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select("*, order_items(*)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * ORDERS_PAGE_SIZE, page * ORDERS_PAGE_SIZE + ORDERS_PAGE_SIZE - 1)
      if (status !== "all") q = q.eq("status", status)
      const term = clean(search)
      if (term) q = q.or(`order_number.ilike.*${term}*,full_name.ilike.*${term}*,email.ilike.*${term}*`)
      const { data, error, count } = await q
      if (error) throw error
      return { orders: data as AdminOrder[], total: count ?? 0 }
    },
  })
}

export function useOrderCounts() {
  return useQuery({
    queryKey: ["admin-order-counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("status")
      if (error) throw error
      const counts: Record<string, number> = { all: data.length }
      for (const o of data) counts[o.status] = (counts[o.status] ?? 0) + 1
      return counts
    },
  })
}

export type AdminOrderDetail = AdminOrder & {
  returns: (Omit<ReturnRequest, "return_items"> & { return_items: { order_item_id: string; quantity: number }[] })[]
}

export function useAdminOrder(orderNumber: string | undefined) {
  return useQuery({
    queryKey: ["admin-order", orderNumber],
    enabled: !!orderNumber,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*), returns(*, return_items(order_item_id, quantity))")
        .eq("order_number", orderNumber!)
        .maybeSingle()
      if (error) throw error
      return data as AdminOrderDetail | null
    },
  })
}

export async function setOrderStatus(orderId: string, status: OrderStatus | "tracking", tracking?: string) {
  const { error } = await supabase.rpc("set_order_status", { p_order_id: orderId, p_status: status, p_tracking: tracking ?? null })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export type CustomerSummary = {
  email: string
  user_id: string | null
  registered_at: string | null
  name: string | null
  country: string | null
  orders: number
  spent_cents: number
  last_order_at: string | null
  newsletter: boolean
}

export function useCustomers() {
  return useQuery({
    queryKey: ["admin-customers"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_customers")
      if (error) throw error
      return data as CustomerSummary[]
    },
  })
}

export type CustomerDetail = {
  email: string
  user_id: string | null
  registered_at: string | null
  last_sign_in_at: string | null
  name: string | null
  newsletter: boolean
  addresses: SavedAddress[]
  orders: (Omit<AdminOrder, "order_items"> & {
    items: OrderItem[]
    returns: { return_number: string; status: ReturnStatus; reason: ReturnReason; created_at: string; refund_cents: number | null }[]
  })[]
}

export function useCustomer(email: string | undefined) {
  return useQuery({
    queryKey: ["admin-customer", email],
    enabled: !!email,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_customer", { p_email: email! })
      if (error) throw error
      return data as CustomerDetail | null
    },
  })
}

// ---------------------------------------------------------------------------
// Products & stock (the owner also sees hidden products)
// ---------------------------------------------------------------------------

export type AdminProduct = Product & { is_published: boolean; updated_at: string }

export function useAdminProducts() {
  return useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, product_variants(*)")
        .order("category_slug")
        .order("sort_order")
      if (error) throw error
      return data as AdminProduct[]
    },
  })
}

export function useAdminProduct(id: string | undefined) {
  return useQuery({
    queryKey: ["admin-product", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*, product_variants(*)").eq("id", id!).maybeSingle()
      if (error) throw error
      return data as AdminProduct | null
    },
  })
}

export type ProductInput = {
  id?: string
  name: string
  slug?: string
  category_slug: string
  short_description: string
  description: string
  materials: string
  care: string[]
  details: string[]
  price_cents: number
  images: string[]
  is_featured: boolean
  is_new: boolean
  is_published: boolean
  colours: (Colour & { previous_name?: string })[]
  sizes: { label: string; previous_label?: string; price_cents?: number | null }[]
}

export async function saveProduct(p: ProductInput) {
  const { data, error } = await supabase.rpc("admin_save_product", { p })
  if (error) return { ok: false as const, code: demoRefused(error) ? DEMO_OFF : error.message }
  return { ok: true as const, id: data.id as string, slug: data.slug as string }
}

export async function setPublished(id: string, published: boolean) {
  const { error } = await supabase.from("products").update({ is_published: published }).eq("id", id)
  if (error) throw error
}

/** Sets a stock number unless it changed since it was read (a sale). */
export async function setStock(variant: Pick<Variant, "id" | "stock">, stock: number) {
  const { data, error } = await supabase.rpc("admin_set_stock", { p_variant_id: variant.id, p_expected: variant.stock, p_stock: stock })
  if (error) throw error
  return data as { ok: boolean; stock: number }
}

/** "Kāpa Crewneck" → "kapa-crewneck" */
export function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

/**
 * Resizes a photo in the browser (max 1600 px wide, WebP) and uploads it to
 * the product-images bucket. Returns the storage path.
 */
export async function uploadProductPhoto(file: File, slug: string) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / bitmap.width)
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82))
  if (!blob) throw new Error("Could not read that image.")
  const path = `products/${slug || "product"}-${Date.now().toString(36)}.webp`
  const { error } = await supabase.storage.from("product-images").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" })
  if (error) throw error
  return path
}

// In the shop's time, not the browser's (see shopDate).
export const dateShort = shopDate({ day: "numeric", month: "short", year: "numeric" })
export const dateTime = shopDate({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
