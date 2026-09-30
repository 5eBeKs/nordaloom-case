import { useQuery } from "@tanstack/react-query"
import { shopDate } from "@/lib/format"
import { supabase } from "@/lib/supabase"
import type { Colour } from "@/lib/catalogue"

export type Fit = "small" | "true" | "large"
export type ReviewStatus = "pending" | "published" | "rejected"

export const FIT_LABEL: Record<Fit, string> = {
  small: "Runs small",
  true: "True to size",
  large: "Runs large",
}

/** Scarves and blankets don't have a fit to speak of. */
export const asksFit = (categorySlug: string) => !["scarves", "blankets"].includes(categorySlug)

export type Review = {
  id: string
  product_id: string
  rating: number
  fit: Fit | null
  body: string
  author_name: string
  status: ReviewStatus
  shop_reply: string | null
  shop_reply_at: string | null
  edited_at: string | null
  created_at: string
  updated_at: string
}

// Who wrote a review isn't readable from the shop, so columns are listed.
const REVIEW_FIELDS = "id, product_id, rating, fit, body, author_name, status, shop_reply, shop_reply_at, edited_at, created_at, updated_at"

export function useProductReviews(productId: string | undefined) {
  return useQuery({
    queryKey: ["reviews", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select(REVIEW_FIELDS)
        .eq("product_id", productId!)
        .eq("status", "published")
        .order("created_at", { ascending: false })
      if (error) throw error
      return data as Review[]
    },
  })
}

/** A piece the signed-in customer has had delivered, with their review if they wrote one. */
export type Reviewable = {
  product_id: string
  slug: string
  name: string
  images: string[]
  colours: Colour[]
  category_slug: string
  is_published: boolean
  asks_fit: boolean
  delivered_at: string
  bought: { colour: string; size: string }[]
  review: Review | null
}

export function useMyReviewables(userId: string | undefined) {
  return useQuery({
    queryKey: ["my-reviewables", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_reviewables")
      if (error) throw error
      return data as Reviewable[]
    },
  })
}

export async function submitReview(input: { productId: string; rating: number; fit: Fit | null; body: string }) {
  const { error } = await supabase.rpc("submit_review", {
    p_product_id: input.productId,
    p_rating: input.rating,
    p_fit: input.fit,
    p_body: input.body,
  })
  return error ? { ok: false as const, code: error.message } : { ok: true as const }
}

export async function deleteMyReview(id: string) {
  const { error } = await supabase.rpc("delete_my_review", { p_review_id: id })
  return !error
}

/** Average, count, and how many said each fit. */
export function summarise(reviews: Review[]) {
  const count = reviews.length
  const average = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0
  const stars = [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: reviews.filter((r) => r.rating === n).length }))
  const fits = { small: 0, true: 0, large: 0 } as Record<Fit, number>
  for (const r of reviews) if (r.fit) fits[r.fit]++
  const fitTotal = fits.small + fits.true + fits.large
  // -1 (runs small) … 0 (true to size) … +1 (runs large)
  const fitLean = fitTotal ? (fits.large - fits.small) / fitTotal : 0
  // Only say "most people" when more than half agree.
  const top = (["true", "small", "large"] as Fit[]).find((f) => fits[f] * 2 > fitTotal)
  const fitVerdict: string | null = !fitTotal
    ? null
    : top === "true"
      ? fitTotal === 1 ? "One person says it's true to size" : "Most people say it's true to size"
      : top === "small"
        ? fitTotal === 1 ? "One person says it runs small" : "Most people say it runs small — consider a size up"
        : top === "large"
          ? fitTotal === 1 ? "One person says it runs large" : "Most people say it runs large — consider a size down"
          : "Opinions on the fit are mixed"
  return { count, average, stars, fits, fitTotal, fitLean, fitVerdict }
}

// ---------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------

export type AdminReview = Review & {
  decided_at: string | null
  email: string | null
  order_number: string | null
  product: { id: string; slug: string; name: string; images: string[]; colours: Colour[]; category_slug: string }
}

export function useAdminReviews() {
  return useQuery({
    queryKey: ["admin-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_reviews")
      if (error) throw error
      return data as AdminReview[]
    },
  })
}

export async function updateReview(id: string, change: { status?: ReviewStatus; reply?: string | null }) {
  const { error } = await supabase.rpc("admin_update_review", {
    p_review_id: id,
    p_status: change.status ?? null,
    p_reply: change.reply ?? null,
    p_set_reply: "reply" in change,
  })
  return !error
}

const reviewDay = shopDate({ day: "numeric", month: "long", year: "numeric" })
export const reviewDate = (d: string) => reviewDay.format(new Date(d))
