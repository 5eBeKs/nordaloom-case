import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import type { Order, OrderItem } from "@/lib/checkout"

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export type ReturnStatus = "requested" | "approved" | "refused" | "refunded"
export type ReturnReason = "too_small" | "too_big" | "not_as_expected" | "faulty" | "changed_mind" | "other"

export const RETURN_REASONS: { value: ReturnReason; label: string }[] = [
  { value: "too_small", label: "Too small" },
  { value: "too_big", label: "Too big" },
  { value: "not_as_expected", label: "Not what I expected" },
  { value: "faulty", label: "Faulty or damaged" },
  { value: "changed_mind", label: "Changed my mind" },
  { value: "other", label: "Something else" },
]

export const reasonLabel = (r: ReturnReason) => RETURN_REASONS.find((x) => x.value === r)?.label ?? r

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: "Return requested",
  approved: "Return approved",
  refused: "Return refused",
  refunded: "Refunded",
}

export type ReturnRequest = {
  id: string
  return_number: string
  order_id: string
  status: ReturnStatus
  reason: ReturnReason
  details: string
  shop_note: string
  refund_cents: number | null
  refund_method: "bank_transfer" | "card" | null
  restocked: boolean
  created_at: string
  decided_at: string | null
  refunded_at: string | null
  return_items: { order_item_id: string; quantity: number }[]
}

/** Pieces of an order item still available to return (not in a pending or accepted return). */
export function returnableQuantity(item: OrderItem, returns: ReturnRequest[]) {
  const taken = returns
    .filter((r) => r.status !== "refused")
    .flatMap((r) => r.return_items)
    .filter((ri) => ri.order_item_id === item.id)
    .reduce((n, ri) => n + ri.quantity, 0)
  return Math.max(0, item.quantity - taken)
}

/** Whether returns can still be requested for an order, and until when. */
export function returnWindow(order: Pick<Order, "status" | "return_until">) {
  if (order.status !== "delivered" || !order.return_until) return { open: false, until: null as Date | null }
  const until = new Date(order.return_until)
  return { open: until.getTime() > Date.now(), until }
}

export async function requestReturn(
  orderNumber: string,
  items: { order_item_id: string; quantity: number }[],
  reason: ReturnReason,
  details: string,
) {
  const { data, error } = await supabase.rpc("request_return", {
    p_order_number: orderNumber,
    p_items: items,
    p_reason: reason,
    p_details: details,
  })
  if (error) return { ok: false as const, code: error.message }
  return { ok: true as const, returnNumber: data as string }
}

// ---------------------------------------------------------------------------
// A customer's orders, with items and returns
// ---------------------------------------------------------------------------

export type AccountOrder = Omit<Order, "items" | "bank" | "return_until" | "is_account_order"> & {
  order_items: OrderItem[]
  returns: ReturnRequest[]
}

export function useMyOrders(userId: string | undefined) {
  return useQuery({
    queryKey: ["my-orders", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*), returns(*, return_items(order_item_id, quantity))")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
      if (error) throw error
      return data as AccountOrder[]
    },
  })
}

export function useOrderReturns(orderId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["order-returns", orderId],
    enabled: !!orderId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("returns")
        .select("*, return_items(order_item_id, quantity)")
        .eq("order_id", orderId!)
        .order("created_at")
      if (error) throw error
      return data as ReturnRequest[]
    },
  })
}

// ---------------------------------------------------------------------------
// Saved addresses
// ---------------------------------------------------------------------------

export const MAX_ADDRESSES = 5

export type SavedAddress = {
  id: string
  label: string
  full_name: string
  phone: string
  country: string
  address_line1: string
  address_line2: string
  city: string
  postal_code: string
  is_default: boolean
  created_at: string
}

export type AddressInput = Omit<SavedAddress, "id" | "is_default" | "created_at"> & { is_default?: boolean }

export function useAddresses(userId: string | undefined) {
  return useQuery({
    queryKey: ["addresses", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_addresses")
        .select("*")
        .order("is_default", { ascending: false })
        .order("created_at")
      if (error) throw error
      return data as SavedAddress[]
    },
  })
}

export async function saveAddress(input: AddressInput, id?: string) {
  const payload = {
    label: input.label.trim(),
    full_name: input.full_name.trim(),
    phone: input.phone.trim(),
    country: input.country,
    address_line1: input.address_line1.trim(),
    address_line2: input.address_line2.trim(),
    city: input.city.trim(),
    postal_code: input.postal_code.trim(),
    ...(input.is_default ? { is_default: true } : {}),
  }
  const { error } = id
    ? await supabase.from("customer_addresses").update(payload).eq("id", id)
    : await supabase.from("customer_addresses").insert(payload)
  return error ? { ok: false as const, code: error.message } : { ok: true as const }
}

export async function deleteAddress(id: string) {
  const { error } = await supabase.from("customer_addresses").delete().eq("id", id)
  return !error
}

export async function makeDefaultAddress(id: string) {
  const { error } = await supabase.from("customer_addresses").update({ is_default: true }).eq("id", id)
  return !error
}

/** Same address, ignoring case and spacing — so checkout doesn't save duplicates. */
export function sameAddress(a: Omit<AddressInput, "label">, b: Omit<AddressInput, "label">) {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")
  return (["country", "address_line1", "address_line2", "city", "postal_code"] as const).every((k) => norm(a[k]) === norm(b[k]))
}

export const dateLong = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
