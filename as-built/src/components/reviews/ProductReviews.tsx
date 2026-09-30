import { useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import type { Product } from "@/lib/catalogue"
import { asksFit, FIT_LABEL, reviewDate, summarise, useMyReviewables, useProductReviews, type Fit, type Review } from "@/lib/reviews"
import { cn } from "@/lib/utils"
import { ReviewSheet } from "./ReviewForm"
import { Stars } from "./Stars"

const PAGE = 6

/** Under the product: the average, how it fits, and the reviews themselves. */
export function ProductReviews({ product }: { product: Product }) {
  const { data: reviews = [], isLoading } = useProductReviews(product.id)
  const [shown, setShown] = useState(PAGE)
  const s = summarise(reviews)
  const fitApplies = asksFit(product.category_slug)

  return (
    <section id="reviews" className="mt-28 scroll-mt-28 border-t pt-16" aria-labelledby="reviews-title">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <h2 id="reviews-title" className="text-3xl md:text-4xl">
            Reviews
          </h2>
          {s.count > 0 ? (
            <>
              <div className="mt-6 flex items-end gap-4">
                <p className="font-serif text-6xl leading-none font-light tabular-nums">{s.average.toFixed(1)}</p>
                <div className="pb-1">
                  <Stars value={s.average} size="size-4" />
                  <p className="mt-1 text-sm text-muted-foreground">
                    {s.count} {s.count === 1 ? "review" : "reviews"}
                  </p>
                </div>
              </div>
              <ul className="mt-6 space-y-1.5" aria-label="Reviews by stars">
                {s.stars.map((r) => (
                  <li key={r.stars} className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="w-12 shrink-0">{r.stars} {r.stars === 1 ? "star" : "stars"}</span>
                    <span className="h-1 flex-1 bg-sand">
                      <span className="block h-full bg-foreground/70" style={{ width: `${(r.count / s.count) * 100}%` }} />
                    </span>
                    <span className="w-5 shrink-0 text-right tabular-nums">{r.count}</span>
                  </li>
                ))}
              </ul>
              {fitApplies && s.fitTotal > 0 && <FitMeter lean={s.fitLean} verdict={s.fitVerdict!} total={s.fitTotal} fits={s.fits} />}
            </>
          ) : (
            !isLoading && <p className="mt-6 text-muted-foreground">No reviews yet for the {product.name}.</p>
          )}
          <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
            Only customers who bought this piece can review it, and we read every review before it appears.{" "}
            <Link to="/terms#reviews" className="underline underline-offset-4">How reviews work</Link>
          </p>
          <WriteReview product={product} />
        </div>

        <div className="lg:col-span-8">
          {s.count > 0 && (
            <>
              <ul className="divide-y border-y">
                {reviews.slice(0, shown).map((r) => (
                  <ReviewItem key={r.id} review={r} />
                ))}
              </ul>
              {s.count > shown && (
                <Button variant="outline" onClick={() => setShown((n) => n + PAGE)} className="mt-8 h-11 rounded-none bg-transparent px-8">
                  Show more reviews
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function FitMeter({ lean, verdict, total, fits }: { lean: number; verdict: string; total: number; fits: Record<Fit, number> }) {
  return (
    <div className="mt-10">
      <p className="text-sm font-medium">How it fits</p>
      <div className="relative mt-4 h-px bg-foreground/25" aria-hidden>
        {[0, 50, 100].map((x) => (
          <span key={x} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-foreground/25" style={{ left: `${x}%` }} />
        ))}
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-4 ring-background"
          style={{ left: `${50 + lean * 50}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 text-xs text-muted-foreground">
        <span>Runs small · {fits.small}</span>
        <span className="text-center">True to size · {fits.true}</span>
        <span className="text-right">Runs large · {fits.large}</span>
      </div>
      <p className="mt-3 text-sm">
        {verdict}
        <span className="text-muted-foreground"> · {total} {total === 1 ? "answer" : "answers"}</span>
      </p>
    </div>
  )
}

function ReviewItem({ review: r }: { review: Review }) {
  return (
    <li className="py-8">
      <article>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Stars value={r.rating} />
          {r.fit && <span className="border px-2 py-0.5 text-xs text-muted-foreground">{FIT_LABEL[r.fit]}</span>}
        </div>
        <p className="mt-4 leading-relaxed whitespace-pre-line">{r.body}</p>
        <p className="mt-4 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{r.author_name}</span> · {reviewDate(r.created_at)} · Bought from Nordaloom
        </p>
        {r.shop_reply && (
          <div className="mt-5 border-l-2 border-clay/40 bg-linen/60 py-3 pr-4 pl-4">
            <p className="eyebrow text-clay">Nordaloom replied</p>
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{r.shop_reply}</p>
          </div>
        )}
      </article>
    </li>
  )
}

/** The "write a review" part: depends on whether this customer has had the piece delivered. */
function WriteReview({ product }: { product: Product }) {
  const { user, loading } = useAuth()
  const { data: reviewables } = useMyReviewables(user?.id)
  const [open, setOpen] = useState(false)
  if (loading) return null

  if (!user) {
    return (
      <p className="mt-10 text-sm text-muted-foreground">
        Bought this piece?{" "}
        <Link to={`/login?next=${encodeURIComponent(`/product/${product.slug}#reviews`)}`} className="text-foreground underline underline-offset-4">
          Sign in
        </Link>{" "}
        to review it.
      </p>
    )
  }
  if (!reviewables) return null
  const item = reviewables.find((x) => x.product_id === product.id)
  if (!item) {
    return <p className="mt-10 text-sm text-muted-foreground">Reviews come from customers whose order of this piece has been delivered.</p>
  }

  const status = item.review?.status
  return (
    <div className={cn("mt-10", item.review && "border bg-card p-5")}>
      {item.review ? (
        <p className="text-sm">
          {status === "pending" && "Thank you for your review — it will appear here once we've read it."}
          {status === "published" && "Thank you for your review — it's in the list."}
          {status === "rejected" && "We decided not to publish your review. You can change it and send it again."}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">You've had this piece delivered — how is it?</p>
      )}
      <Button onClick={() => setOpen(true)} variant={item.review ? "outline" : "default"} className={cn("mt-4 h-11 rounded-none px-8", item.review && "bg-transparent")}>
        {item.review ? "Change your review" : "Write a review"}
      </Button>
      <ReviewSheet item={item} open={open} onOpenChange={setOpen} />
    </div>
  )
}
