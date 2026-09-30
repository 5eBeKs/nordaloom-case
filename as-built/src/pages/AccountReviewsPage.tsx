import { useState } from "react"
import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ProductImage } from "@/components/art/ProductImage"
import { ReviewSheet } from "@/components/reviews/ReviewForm"
import { Stars } from "@/components/reviews/Stars"
import { useAuth } from "@/context/AuthContext"
import { dateLong } from "@/lib/account"
import { deleteMyReview, FIT_LABEL, useMyReviewables, type Reviewable, type ReviewStatus } from "@/lib/reviews"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"

const STATUS: Record<ReviewStatus, { label: string; className: string }> = {
  pending: { label: "Waiting to be read", className: "bg-sand text-foreground/80" },
  published: { label: "Published", className: "bg-moss/15 text-moss" },
  rejected: { label: "Not published", className: "bg-muted text-muted-foreground" },
}

export function AccountReviewsPage() {
  useTitle("Your reviews")
  const { user } = useAuth()
  const { data: items, isLoading } = useMyReviewables(user?.id)
  const [editing, setEditing] = useState<Reviewable | null>(null)
  const [open, setOpen] = useState(false)

  if (isLoading || !items) return <p className="py-10 text-muted-foreground">Loading…</p>

  if (items.length === 0) {
    return (
      <div className="max-w-lg py-6">
        <p className="text-lg text-muted-foreground">Nothing to review yet.</p>
        <p className="mt-2 text-sm text-muted-foreground">Once an order has been delivered, you can review each piece in it here.</p>
      </div>
    )
  }

  const toWrite = items.filter((i) => !i.review)
  const written = items.filter((i) => i.review)

  function edit(item: Reviewable) {
    setEditing(item)
    setOpen(true)
  }

  return (
    <div className="max-w-4xl space-y-14">
      {toWrite.length > 0 && (
        <section>
          <h2 className="text-2xl">Waiting for your review</h2>
          <p className="mt-2 text-sm text-muted-foreground">A few stars and a word on how it fits help the next person choose.</p>
          <ul className="mt-6 divide-y border-y">
            {toWrite.map((item) => (
              <li key={item.product_id} className="flex items-center gap-5 py-5">
                <Thumb item={item} />
                <div className="min-w-0 flex-1 text-sm">
                  <ProductName item={item} />
                  <p className="mt-0.5 text-muted-foreground">Delivered {dateLong(item.delivered_at)}</p>
                </div>
                <Button onClick={() => edit(item)} className="h-10 shrink-0 rounded-none px-5">
                  Write a review
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {written.length > 0 && (
        <section>
          <h2 className="text-2xl">Your reviews</h2>
          <p className="mt-2 text-sm text-muted-foreground">We read every review before it appears in the shop.</p>
          <ul className="mt-6 divide-y border-y">
            {written.map((item) => (
              <WrittenReview key={item.product_id} item={item} onEdit={() => edit(item)} />
            ))}
          </ul>
        </section>
      )}

      <ReviewSheet item={editing} open={open} onOpenChange={setOpen} />
    </div>
  )
}

function WrittenReview({ item, onEdit }: { item: Reviewable; onEdit: () => void }) {
  const r = item.review!
  const [confirming, setConfirming] = useState(false)
  const queryClient = useQueryClient()

  async function remove() {
    const ok = await deleteMyReview(r.id)
    if (!ok) {
      toast.error("We couldn't delete your review. Please try again.")
      return
    }
    for (const key of ["my-reviewables", "reviews", "products", "product"]) void queryClient.invalidateQueries({ queryKey: [key] })
    toast("Your review is deleted.")
  }

  return (
    <li className="flex gap-5 py-6">
      <Thumb item={item} />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <ProductName item={item} />
          <span className={cn("px-2 py-1 text-[0.7rem] font-semibold tracking-[0.1em] uppercase", STATUS[r.status].className)}>{STATUS[r.status].label}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Stars value={r.rating} />
          {r.fit && <span className="text-xs text-muted-foreground">{FIT_LABEL[r.fit]}</span>}
        </div>
        <p className="mt-3 leading-relaxed whitespace-pre-line">{r.body}</p>
        {r.status === "rejected" && (
          <p className="mt-3 text-muted-foreground">We decided not to publish this review. You can change it and send it again.</p>
        )}
        {r.shop_reply && (
          <div className="mt-4 border-l-2 border-clay/40 bg-linen/60 px-4 py-3">
            <p className="eyebrow text-clay">Nordaloom replied</p>
            <p className="mt-2 leading-relaxed whitespace-pre-line">{r.shop_reply}</p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button type="button" onClick={onEdit} className="underline underline-offset-4">
            Change
          </button>
          {confirming ? (
            <span className="flex items-center gap-3">
              <span className="text-muted-foreground">Delete this review?</span>
              <button type="button" onClick={remove} className="text-destructive underline underline-offset-4">
                Delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="underline underline-offset-4">
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="text-muted-foreground underline underline-offset-4">
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function Thumb({ item }: { item: Reviewable }) {
  return (
    <div className="aspect-[4/5] w-16 shrink-0 self-start overflow-hidden bg-muted sm:w-20">
      <ProductImage product={item} />
    </div>
  )
}

function ProductName({ item }: { item: Reviewable }) {
  const bought = item.bought.map((b) => [b.colour, b.size !== "One size" ? b.size : null].filter(Boolean).join(", ")).join(" · ")
  return (
    <div>
      {item.is_published ? (
        <Link to={`/product/${item.slug}`} className="font-medium hover:underline">
          {item.name}
        </Link>
      ) : (
        <span className="font-medium">{item.name}</span>
      )}
      {bought && <p className="text-muted-foreground">{bought}</p>}
    </div>
  )
}
