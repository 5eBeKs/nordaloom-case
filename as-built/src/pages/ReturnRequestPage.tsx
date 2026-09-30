import { useState, type FormEvent } from "react"
import { Link, useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductImage } from "@/components/art/ProductImage"
import { useAuth } from "@/context/AuthContext"
import { formatPrice } from "@/lib/format"
import { useShopSettings } from "@/lib/checkout"
import { dateLong, requestReturn, RETURN_REASONS, returnableQuantity, useMyOrders, type ReturnReason } from "@/lib/account"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"

const ERRORS: Record<string, string> = {
  not_delivered: "Returns can be requested once your order has been delivered.",
  window_closed: "The return period for this order has ended.",
  invalid_items: "Some of those pieces are already part of another return. Please refresh and try again.",
  details_required: "Please tell us a little more about why you're returning it.",
  details_too_long: "Please keep your note under 1000 characters.",
  no_items: "Please tick at least one piece to return.",
  invalid_reason: "Please choose a reason.",
}

export function ReturnRequestPage() {
  useTitle("Request a return")
  const { orderNumber } = useParams()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { data: orders, isLoading } = useMyOrders(user?.id)
  const { data: settings } = useShopSettings()
  const order = orders?.find((o) => o.order_number === orderNumber)

  const [selected, setSelected] = useState<Record<string, number>>({})
  const [reason, setReason] = useState<ReturnReason | "">("")
  const [details, setDetails] = useState("")
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  if (isLoading) return <p className="py-10 text-muted-foreground">Loading…</p>
  if (!order) {
    return (
      <p className="py-10 text-muted-foreground">
        We couldn't find that order in your account.{" "}
        <Link to="/account" className="text-foreground underline underline-offset-4">
          Back to your orders
        </Link>
      </p>
    )
  }

  const returnDays = settings?.return_days ?? 14
  const until = order.delivered_at ? new Date(new Date(order.delivered_at).getTime() + returnDays * 86_400_000) : null
  const open = order.status === "delivered" && !!until && until.getTime() > Date.now()
  const returnable = order.order_items.map((i) => ({ item: i, max: returnableQuantity(i, order.returns) }))
  const chosen = Object.entries(selected).filter(([, q]) => q > 0)
  const refundEstimate = chosen.reduce((sum, [id, q]) => sum + (order.order_items.find((i) => i.id === id)?.unit_price_cents ?? 0) * q, 0)

  if (done) {
    return (
      <div className="max-w-2xl">
        <p className="flex items-center gap-2 text-sm text-moss">
          <Check className="size-4" /> Request sent
        </p>
        <h2 className="mt-3 text-3xl">Return {done} is with us</h2>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          We'll look at your request and reply on your orders page — if it's approved, we'll tell you there where to
          send the pieces. Please don't post anything until then.
        </p>
        <Button asChild className="mt-8 h-11 rounded-none px-8">
          <Link to="/account">Back to your orders</Link>
        </Button>
      </div>
    )
  }

  if (!open || returnable.every((r) => r.max === 0)) {
    return (
      <div className="max-w-2xl">
        <h2 className="text-3xl">Returns for {order.order_number}</h2>
        <p className="mt-4 text-muted-foreground">
          {order.status !== "delivered"
            ? "Returns can be requested once your order has been delivered."
            : until && until.getTime() <= Date.now()
              ? `The ${returnDays}-day return period ended on ${dateLong(until)}.`
              : "All pieces from this order are already part of a return."}
        </p>
        <Link to="/account" className="mt-6 inline-block text-sm underline underline-offset-4">
          Back to your orders
        </Link>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError("")
    if (chosen.length === 0) return setError(ERRORS.no_items)
    if (!reason) return setError(ERRORS.invalid_reason)
    if (reason === "other" && !details.trim()) return setError(ERRORS.details_required)
    setSending(true)
    const result = await requestReturn(
      order!.order_number,
      chosen.map(([order_item_id, quantity]) => ({ order_item_id, quantity })),
      reason,
      details.trim(),
    )
    setSending(false)
    if (!result.ok) {
      setError(ERRORS[result.code] ?? "Something went wrong. Please try again.")
      void queryClient.invalidateQueries({ queryKey: ["my-orders"] })
      return
    }
    void queryClient.invalidateQueries({ queryKey: ["my-orders"] })
    void queryClient.invalidateQueries({ queryKey: ["order-returns"] })
    setDone(result.returnNumber)
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-12 lg:grid-cols-12 lg:gap-16">
      <div className="lg:col-span-7">
        <Link to="/account" className="text-xs text-muted-foreground hover:text-foreground">
          ← Your orders
        </Link>
        <h2 className="mt-3 text-3xl">Return pieces from {order.order_number}</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Delivered {order.delivered_at && dateLong(order.delivered_at)} · returns possible until {until && dateLong(until)}
        </p>

        <fieldset className="mt-8">
          <legend className="text-lg">Which pieces are you sending back?</legend>
          <ul className="mt-4 divide-y border-y">
            {returnable.map(({ item, max }) => {
              const qty = selected[item.id] ?? 0
              const disabled = max === 0
              return (
                <li key={item.id} className={cn("flex items-center gap-4 py-4", disabled && "opacity-50")}>
                  <input
                    type="checkbox"
                    id={`item-${item.id}`}
                    disabled={disabled}
                    checked={qty > 0}
                    onChange={(e) => {
                      setSelected((s) => ({ ...s, [item.id]: e.target.checked ? 1 : 0 }))
                      setError("")
                    }}
                    className="size-4 accent-foreground"
                  />
                  <label htmlFor={`item-${item.id}`} className="flex flex-1 cursor-pointer items-center gap-4">
                    <span className="block aspect-[4/5] w-14 shrink-0 overflow-hidden bg-muted">
                      <ProductImage
                        product={{ slug: item.product_slug, category_slug: "", name: item.product_name, images: item.product_image ? [item.product_image] : [], colours: [] }}
                      />
                    </span>
                    <span className="text-sm">
                      <span className="block font-medium">{item.product_name}</span>
                      <span className="text-muted-foreground">
                        {item.colour}
                        {item.size !== "One size" && <> · {item.size}</>} · {formatPrice(item.unit_price_cents)}
                      </span>
                      {disabled && <span className="block text-xs">Already in a return</span>}
                    </span>
                  </label>
                  {max > 1 && qty > 0 && (
                    <select
                      aria-label={`How many ${item.product_name}`}
                      value={qty}
                      onChange={(e) => setSelected((s) => ({ ...s, [item.id]: Number(e.target.value) }))}
                      className="h-9 border border-input bg-card px-2 text-sm"
                    >
                      {Array.from({ length: max }, (_, n) => (
                        <option key={n + 1} value={n + 1}>
                          {n + 1} of {max}
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              )
            })}
          </ul>
        </fieldset>

        <fieldset className="mt-10">
          <legend className="text-lg">Why are you returning it?</legend>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {RETURN_REASONS.map((r) => (
              <label
                key={r.value}
                className={cn(
                  "flex cursor-pointer items-center gap-3 border px-4 py-3 text-sm transition-colors",
                  reason === r.value ? "border-foreground bg-card" : "border-input hover:border-foreground/40",
                )}
              >
                <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => {
                    setReason(r.value)
                    setError("")
                  }} className="accent-foreground" />
                {r.label}
              </label>
            ))}
          </div>
          <label htmlFor="details" className="mt-6 block text-sm">
            Tell us more {reason === "other" ? "" : <span className="text-muted-foreground">(optional)</span>}
          </label>
          <textarea
            id="details"
            rows={4}
            maxLength={1000}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="e.g. The sleeves are longer than I expected"
            className="mt-2 w-full border border-input bg-card p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </fieldset>
      </div>

      <aside className="lg:col-span-5">
        <div className="bg-linen p-7 lg:sticky lg:top-28">
          <h3 className="text-xl">How returns work</h3>
          <ol className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <li>1. Send us this request — you don't need to post anything yet.</li>
            <li>2. We reply on your orders page. If approved, we'll tell you where to send the pieces.</li>
            <li>3. Once they're back with us, we refund the pieces the way you paid — to your card, or to your bank account.</li>
          </ol>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Return postage is yours to pay, unless a piece is faulty.{" "}
            <Link to="/returns" className="underline underline-offset-4">Our returns policy</Link>
          </p>
          <div className="mt-6 flex items-baseline justify-between border-t pt-4 text-sm">
            <span>Value of pieces</span>
            <span className="font-serif text-xl tabular-nums">{formatPrice(refundEstimate)}</span>
          </div>
          {error && (
            <p className="mt-5 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={sending} className="mt-6 h-12 w-full rounded-none text-[0.8rem] tracking-[0.12em] uppercase">
            {sending ? "Sending…" : "Send return request"}
          </Button>
        </div>
      </aside>
    </form>
  )
}
