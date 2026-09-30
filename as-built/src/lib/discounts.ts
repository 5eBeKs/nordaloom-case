import { useEffect, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { formatPrice } from "@/lib/format"

export type DiscountReason =
  | "not_found"
  | "inactive"
  | "expired"
  | "used_up"
  | "min_order"
  | "not_first_order"
  | "already_used"

export type DiscountCheck = {
  ok: boolean
  code: string
  kind?: "percent" | "fixed"
  value?: number
  discount_cents?: number
  reason?: DiscountReason
  min_order_cents?: number | null
  first_order_only?: boolean
  once_per_customer?: boolean
  ends_at?: string | null
  /** A first-order or once-per-customer code, checked again when we know the email. */
  needs_email?: boolean
}

/** "10% off", "€20 off" */
export function describeDiscount(d: { kind?: "percent" | "fixed"; value?: number }) {
  if (!d.kind || !d.value) return ""
  return d.kind === "percent" ? `${d.value}% off` : `${formatPrice(d.value)} off`
}

/** Why a code doesn't apply, in the customer's words. */
export function discountMessage(d: DiscountCheck) {
  switch (d.reason) {
    case "not_found":
      return `We don't recognise the code “${d.code}”. Please check the spelling.`
    case "inactive":
      return `The code ${d.code} isn't active at the moment.`
    case "expired":
      return `The code ${d.code} has expired.`
    case "used_up":
      return `The code ${d.code} has been used up — sorry.`
    case "min_order":
      return `${d.code} works on orders of ${formatPrice(d.min_order_cents ?? 0)} or more.`
    case "not_first_order":
      return `${d.code} is for a first order only, and this email address has ordered before.`
    case "already_used":
      return `You've already used ${d.code} — it works once per customer.`
    default:
      return "That code can't be used right now."
  }
}

export async function checkDiscount(code: string, subtotal: number, email?: string) {
  const { data, error } = await supabase.rpc("check_discount", { p_code: code, p_subtotal_cents: subtotal, p_email: email || null })
  if (error) throw error
  return data as DiscountCheck
}

/** Live check of the code in the bag, redone when the basket or email changes. */
export function useDiscount(code: string | null, subtotal: number, email?: string) {
  const [debouncedEmail, setDebouncedEmail] = useState(email)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedEmail(email), 400)
    return () => clearTimeout(t)
  }, [email])
  const validEmail = debouncedEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(debouncedEmail.trim()) ? debouncedEmail.trim() : undefined

  return useQuery({
    queryKey: ["discount", code, subtotal, validEmail],
    enabled: !!code && subtotal > 0,
    placeholderData: keepPreviousData,
    queryFn: () => checkDiscount(code!, subtotal, validEmail),
    staleTime: 30_000,
  })
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type DiscountCode = {
  id: string
  code: string
  note: string
  kind: "percent" | "fixed"
  value: number
  min_order_cents: number | null
  ends_at: string | null
  max_uses: number | null
  first_order_only: boolean
  once_per_customer: boolean
  is_active: boolean
  created_at: string
  uses: number
  paid_uses: number
  given_cents: number
  pending_cents: number
  sales_cents: number
  last_used_at: string | null
}

export function useDiscountCodes() {
  return useQuery({
    queryKey: ["admin-discounts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_discount_codes")
      if (error) throw error
      return data as DiscountCode[]
    },
  })
}

export type DiscountInput = Omit<DiscountCode, "id" | "created_at" | "uses" | "paid_uses" | "given_cents" | "pending_cents" | "sales_cents" | "last_used_at">

export async function saveDiscountCode(input: DiscountInput, id?: string) {
  const { error } = id
    ? await supabase.from("discount_codes").update(input).eq("id", id)
    : await supabase.from("discount_codes").insert(input)
  if (!error) return { ok: true as const }
  const code = error.code === "23505" ? "duplicate" : error.message
  return { ok: false as const, code }
}

export async function deleteDiscountCode(id: string) {
  const { error } = await supabase.from("discount_codes").delete().eq("id", id)
  return error ? (error.message === "code_in_use" ? "code_in_use" : "error") : null
}

/** Where a code stands today. */
export function codeStatus(c: DiscountCode): { label: string; tone: "live" | "off" | "warn" } {
  if (!c.is_active) return { label: "Paused", tone: "off" }
  if (c.ends_at && new Date(c.ends_at) <= new Date()) return { label: "Ended", tone: "off" }
  if (c.max_uses !== null && c.uses >= c.max_uses) return { label: "Used up", tone: "off" }
  if (c.ends_at && new Date(c.ends_at).getTime() - Date.now() < 3 * 86_400_000) return { label: "Ending soon", tone: "warn" }
  return { label: "Active", tone: "live" }
}
