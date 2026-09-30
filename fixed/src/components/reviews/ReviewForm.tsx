import { useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { ProductImage } from "@/components/art/ProductImage"
import { FIT_LABEL, submitReview, type Fit, type Reviewable } from "@/lib/reviews"
import { cn } from "@/lib/utils"
import { StarInput } from "./Stars"

const MAX = 2000

/** Writing (or changing) a review, in a side panel. */
export function ReviewSheet({ item, open, onOpenChange }: { item: Reviewable | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto bg-background p-0 sm:max-w-lg">
        {item && <ReviewForm key={item.product_id} item={item} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function ReviewForm({ item, onDone }: { item: Reviewable; onDone: () => void }) {
  const existing = item.review
  const [rating, setRating] = useState(existing?.rating ?? 0)
  const [fit, setFit] = useState<Fit | null>(existing?.fit ?? null)
  const [body, setBody] = useState(existing?.body ?? "")
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)
  const queryClient = useQueryClient()

  const missing = [!rating && "a star rating", item.asks_fit && !fit && "how it fits", !body.trim() && "a few words"].filter(Boolean) as string[]

  async function save(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (missing.length) return
    setSaving(true)
    const res = await submitReview({ productId: item.product_id, rating, fit: item.asks_fit ? fit : null, body: body.trim() })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.code.includes("not_delivered") ? "Reviews open once your order has been delivered." : "We couldn't save your review. Please try again.")
      return
    }
    for (const key of ["my-reviewables", "reviews", "products", "product"]) void queryClient.invalidateQueries({ queryKey: [key] })
    toast.success(existing ? "Thank you — your changes will appear once we've read them." : "Thank you — your review will appear once we've read it.")
    onDone()
  }

  // Enough of the product to draw its picture.
  const pictured = { slug: item.slug, name: item.name, images: item.images, colours: item.colours, category_slug: item.category_slug }
  const bought = item.bought.map((b) => [b.colour, b.size !== "One size" ? b.size : null].filter(Boolean).join(", ")).join(" · ")

  return (
    <form onSubmit={save} className="flex min-h-full flex-col" noValidate>
      <div className="border-b px-6 py-6 sm:px-8">
        <SheetTitle className="text-3xl font-light">{existing ? "Your review" : "Write a review"}</SheetTitle>
        <SheetDescription className="mt-2 text-sm text-muted-foreground">
          We read every review before it appears in the shop.
        </SheetDescription>
        <div className="mt-6 flex items-center gap-4">
          <div className="aspect-[4/5] w-16 shrink-0 overflow-hidden bg-muted">
            <ProductImage product={pictured} />
          </div>
          <div className="min-w-0 text-sm">
            <p className="font-medium">{item.name}</p>
            {bought && <p className="mt-0.5 text-muted-foreground">You bought: {bought}</p>}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-8 px-6 py-8 sm:px-8">
        <fieldset>
          <legend className="text-sm font-medium">How would you rate it?</legend>
          <div className="mt-3">
            <StarInput value={rating} onChange={setRating} />
          </div>
        </fieldset>

        {item.asks_fit && (
          <fieldset>
            <legend className="text-sm font-medium">How does it fit?</legend>
            <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="How does it fit?">
              {(["small", "true", "large"] as Fit[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={fit === f}
                  onClick={() => setFit(f)}
                  className={cn(
                    "h-11 border px-2 text-sm transition-colors",
                    fit === f ? "border-foreground bg-foreground text-background" : "border-input hover:border-foreground",
                  )}
                >
                  {f === "small" ? "Small" : f === "true" ? "True to size" : "Large"}
                </button>
              ))}
            </div>
            {fit && <p className="mt-2 text-xs text-muted-foreground">{FIT_LABEL[fit]}{fit !== "true" && " — useful for choosing a size"}</p>}
          </fieldset>
        )}

        <div>
          <label htmlFor="review-body" className="text-sm font-medium">
            A few words
          </label>
          <textarea
            id="review-body"
            rows={6}
            maxLength={MAX}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="How does it feel to wear? How has it washed? Anything you'd tell a friend?"
            className="mt-3 w-full border border-input bg-card p-3 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">{MAX - body.length} characters left</p>
        </div>

        {existing?.status === "published" && (
          <p className="text-xs text-muted-foreground">Changing a published review takes it off the shop until we've read the new version.</p>
        )}

        {tried && missing.length > 0 && (
          <p className="text-sm text-destructive" role="alert">
            Please add {missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.
          </p>
        )}
      </div>

      <div className="sticky bottom-0 flex gap-3 border-t bg-background px-6 py-5 sm:px-8">
        <Button type="submit" disabled={saving} className="h-12 flex-1 rounded-none text-[0.8rem] tracking-[0.12em] uppercase">
          {saving ? "Sending…" : existing ? "Save changes" : "Send review"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone} className="h-12 rounded-none bg-transparent px-6">
          Cancel
        </Button>
      </div>
    </form>
  )
}
