import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { shopDay } from "@/lib/format"
import { supabase } from "@/lib/supabase"

export type Group = "day" | "week" | "month"

export type Summary = {
  orders: number
  revenue_cents: number
  pieces: number
  discount_cents: number
  shipping_cents: number
  vat_cents: number
  customers: number
  refunded_cents: number
}

export type Report = {
  period: { from: string; to: string; days: number; group: Group; previous_from: string; previous_to: string }
  summary: { current: Summary; previous: Summary }
  series: { start: string; orders: number; revenue_cents: number; previous_orders: number; previous_revenue_cents: number }[]
  categories: { category: string; units: number; revenue_cents: number; previous_revenue_cents: number; returned_units: number }[]
  products: { product: string; category: string; units: number; revenue_cents: number; returned_units: number; previous_units: number; stock: number | null }[]
  sizes: { size: string; units: number; revenue_cents: number; returned_units: number; stock: number }[]
  colours: { colour: string; units: number; revenue_cents: number; stock: number }[]
  sitting: { product: string; category: string | null; colour: string; size: string; stock: number; last_sold: string | null }[]
  customers: {
    new: number
    returning: number
    new_orders: number
    returning_orders: number
    new_revenue_cents: number
    returning_revenue_cents: number
    first_timers: number
    first_timers_came_back: number
    all_customers: number
    all_repeat_customers: number
    median_days_to_second_order: number | null
  }
  returns: {
    orders: number
    orders_with_returns: number
    pieces_sold: number
    pieces_returned: number
    refunded_cents: number
    reasons: { reason: string; returns: number; pieces: number; refused: number }[]
  }
  discounts: { code: string; orders: number; revenue_cents: number; discount_cents: number; average_order_cents: number; first_orders: number }[]
  payments: { method: "bank_transfer" | "card"; started: number; paid: number; never_paid: number; waiting: number; cancelled_by_shop: number; never_paid_cents: number }[]
  countries: { country: string; orders: number; revenue_cents: number; shipping_cents: number; customers: number; locker_orders: number }[]
}

export function useReport(from: string, to: string, group: Group) {
  return useQuery({
    queryKey: ["admin-report", from, to, group],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_report", { p_from: from, p_to: to, p_group: group })
      if (error) throw error
      return data as Report
    },
  })
}

// ---------------------------------------------------------------------------
// Periods (in Latvian time, like the rest of the shop)
// ---------------------------------------------------------------------------

/** Today's date in Latvia, as YYYY-MM-DD. */
export function todayRiga() {
  return shopDay(Date.now())
}

const toDate = (s: string) => new Date(`${s}T00:00:00Z`)
const toIso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (s: string, n: number) => toIso(new Date(toDate(s).getTime() + n * 86_400_000))
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000) + 1

export type Preset = { key: string; label: string; range: () => [string, string] }

export const PRESETS: Preset[] = [
  { key: "7d", label: "Last 7 days", range: () => [addDays(todayRiga(), -6), todayRiga()] },
  { key: "30d", label: "Last 30 days", range: () => [addDays(todayRiga(), -29), todayRiga()] },
  { key: "month", label: "This month", range: () => [`${todayRiga().slice(0, 7)}-01`, todayRiga()] },
  {
    key: "last-month",
    label: "Last month",
    range: () => {
      const first = toDate(`${todayRiga().slice(0, 7)}-01`)
      const end = new Date(first.getTime() - 86_400_000)
      return [`${toIso(end).slice(0, 7)}-01`, toIso(end)]
    },
  },
  {
    key: "quarter",
    label: "This quarter",
    range: () => {
      const t = todayRiga()
      const q = Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1
      return [`${t.slice(0, 4)}-${String(q).padStart(2, "0")}-01`, t]
    },
  },
  { key: "year", label: "This year", range: () => [`${todayRiga().slice(0, 4)}-01-01`, todayRiga()] },
  { key: "12m", label: "Last 12 months", range: () => [addDays(todayRiga(), -364), todayRiga()] },
]

/** A sensible grouping for a period's length. */
export const defaultGroup = (days: number): Group => (days <= 45 ? "day" : days <= 200 ? "week" : "month")

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
const dayYearFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

export const formatDay = (s: string, withYear = false) => (withYear ? dayYearFmt : dayFmt).format(toDate(s))
export const formatBucket = (s: string, g: Group) => (g === "month" ? monthFmt.format(toDate(s)) : g === "week" ? `Week of ${dayFmt.format(toDate(s))}` : dayFmt.format(toDate(s)))

export function formatRange(from: string, to: string) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  return `${formatDay(from, !sameYear)} – ${formatDay(to, true)}`
}

/** Change against the previous period, as a fraction (null when there's nothing to compare with). */
export const change = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : null) : (now - before) / before)

export const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole)
