import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ProductImage } from "@/components/art/ProductImage"
import { Stars } from "@/components/reviews/Stars"
import { DEMO_OFF, DEMO_REVIEWS_OFF } from "@/lib/demo"
import { FIT_LABEL, reviewDate, updateReview, useAdminReviews, type AdminReview, type ReviewStatus } from "@/lib/reviews"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, FilterTabs, PageHeader, SearchInput } from "./ui"

type Filter = ReviewStatus | "all"
const FILTERS: { key: Filter; label: string }[] = [
  { key: "pending", label: "To read" },
  { key: "published", label: "Published" },
  { key: "rejected", label: "Not published" },
  { key: "all", label: "All" },
]

const BADGE: Record<ReviewStatus, { label: string; className: string }> = {
  pending: { label: "To read", className: "bg-clay/10 text-clay" },
  published: { label: "Published", className: "bg-moss/15 text-moss" },
  rejected: { label: "Not published", className: "bg-muted text-muted-foreground" },
}

export function ReviewsPage() {
  useTitle("Reviews")
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS.some((f) => f.key === params.get("status")) ? params.get("status") : "pending") as Filter
  const [search, setSearch] = useState("")
  const { data: reviews = [], isLoading } = useAdminReviews()

  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, f.key === "all" ? reviews.length : reviews.filter((r) => r.status === f.key).length]))
  const q = search.trim().toLowerCase()
  const shown = reviews.filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      (!q || [r.product.name, r.author_name, r.email ?? "", r.body].some((s) => s.toLowerCase().includes(q))),
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reviews"
        intro="Customers can review a piece once their order has been delivered. Each review waits here until you publish it; you can answer under any review as the shop."
      />
      <div>
        <FilterTabs options={FILTERS} value={filter} onChange={(v) => setParams(v === "pending" ? {} : { status: v })} counts={counts} />
        <div className="pt-6">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by piece, customer or words" className="w-full max-w-sm" />
        </div>
        {isLoading ? (
          <Empty>Loading reviews…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{q ? "No reviews match." : filter === "pending" ? "No reviews waiting to be read." : "No reviews here yet."}</Empty>
        ) : (
          <ul className="mt-6 divide-y border-y">
            {shown.map((r) => (
              <ReviewRow key={r.id} review={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ReviewRow({ review: r }: { review: AdminReview }) {
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState(r.shop_reply ?? "")
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  async function change(what: { status?: ReviewStatus; reply?: string | null }, message: string) {
    setBusy(true)
    const ok = await updateReview(r.id, what)
    setBusy(false)
    if (ok !== true) {
      toast.error(ok === DEMO_OFF ? DEMO_REVIEWS_OFF : "That didn't work — please refresh and try again.")
      return false
    }
    toast.success(message)
    for (const key of ["admin-reviews", "admin-waiting", "reviews", "products", "product"]) void queryClient.invalidateQueries({ queryKey: [key] })
    return true
  }

  async function saveReply() {
    const text = reply.trim()
    if (await change({ reply: text || null }, text ? (r.status === "published" ? "Your reply is on the shop." : "Your reply is saved — it appears with the review once published.") : "Your reply is removed.")) {
      setReplying(false)
    }
  }

  async function removeReply() {
    if (await change({ reply: null }, "Your reply is removed.")) {
      setReply("")
      setReplying(false)
    }
  }

  return (
    <li className="grid gap-6 px-2 py-8 md:grid-cols-12">
      <div className="flex gap-4 md:col-span-4">
        <div className="aspect-[4/5] w-16 shrink-0 self-start overflow-hidden bg-muted">
          <ProductImage product={r.product} />
        </div>
        <div className="min-w-0 text-sm">
          <Link to={`/product/${r.product.slug}#reviews`} className="font-medium hover:underline">
            {r.product.name}
          </Link>
          <p className="mt-1">{r.author_name}</p>
          {r.email && (
            <Link to={`/admin/customers/${encodeURIComponent(r.email)}`} className="block truncate text-muted-foreground hover:underline">
              {r.email}
            </Link>
          )}
          <p className="text-muted-foreground">
            {reviewDate(r.created_at)}
            {r.order_number && (
              <>
                {" · "}
                <Link to={`/admin/orders/${r.order_number}`} className="hover:underline">
                  {r.order_number}
                </Link>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="min-w-0 md:col-span-8">
        <div className="flex flex-wrap items-center gap-3">
          <Stars value={r.rating} size="size-4" />
          {r.fit && <span className="border px-2 py-0.5 text-xs text-muted-foreground">{FIT_LABEL[r.fit]}</span>}
          <span className={cn("ml-auto px-2 py-1 text-[0.7rem] font-semibold tracking-[0.1em] uppercase", BADGE[r.status].className)}>{BADGE[r.status].label}</span>
        </div>
        <p className="mt-4 leading-relaxed whitespace-pre-line">{r.body}</p>
        {r.edited_at && <p className="mt-2 text-xs text-muted-foreground">Changed by the customer on {reviewDate(r.edited_at)}</p>}

        {/* The shop's answer */}
        {replying ? (
          <div className="mt-5 space-y-3 border-l-2 border-clay/40 pl-4">
            <label htmlFor={`reply-${r.id}`} className="eyebrow block text-clay">
              Your reply, as Nordaloom
            </label>
            <textarea
              id={`reply-${r.id}`}
              rows={4}
              maxLength={2000}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Thank them, answer a question, or add a tip about size or care."
              className="w-full border border-input bg-card p-3 text-sm leading-relaxed"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="rounded-none" disabled={busy} onClick={saveReply}>
                Save reply
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-none bg-transparent"
                disabled={busy}
                onClick={() => {
                  setReply(r.shop_reply ?? "")
                  setReplying(false)
                }}
              >
                Cancel
              </Button>
              {r.shop_reply && (
                <Button size="sm" variant="ghost" className="rounded-none text-destructive" disabled={busy} onClick={removeReply}>
                  Remove reply
                </Button>
              )}
            </div>
          </div>
        ) : (
          r.shop_reply && (
            <div className="mt-5 border-l-2 border-clay/40 bg-linen/60 px-4 py-3 text-sm">
              <p className="eyebrow text-clay">Nordaloom replied{r.shop_reply_at && <span className="text-muted-foreground normal-case tracking-normal font-normal"> · {reviewDate(r.shop_reply_at)}</span>}</p>
              <p className="mt-2 leading-relaxed whitespace-pre-line">{r.shop_reply}</p>
            </div>
          )
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {r.status !== "published" && (
            <Button size="sm" className="rounded-none" disabled={busy} onClick={() => change({ status: "published" }, "The review is on the shop.")}>
              Publish
            </Button>
          )}
          {r.status !== "rejected" && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-none bg-transparent"
              disabled={busy}
              onClick={() => change({ status: "rejected" }, r.status === "published" ? "The review is off the shop." : "The review won't be published.")}
            >
              {r.status === "published" ? "Take off the shop" : "Don't publish"}
            </Button>
          )}
          {!replying && (
            <Button
              size="sm"
              variant="ghost"
              className="rounded-none"
              onClick={() => {
                setReply(r.shop_reply ?? "")
                setReplying(true)
              }}
            >
              {r.shop_reply ? "Change reply" : "Reply"}
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
