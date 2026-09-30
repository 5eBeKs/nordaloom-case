import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { Check, Copy, CreditCard, Home, Landmark, Loader2, Package, RotateCcw, Truck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductImage } from "@/components/art/ProductImage"
import { formatPrice } from "@/lib/format"
import { countryName, rememberedToken, STATUS_LABEL, useOrder, type Order } from "@/lib/checkout"
import { useTitle } from "@/hooks/use-title"
import { useAuth } from "@/context/AuthContext"
import { dateLong, returnableQuantity, returnWindow, useOrderReturns } from "@/lib/account"
import { ReturnBadge } from "@/components/Badges"
import { cn } from "@/lib/utils"
import { cardLabel, checkCardPayment, goToCardPayment, PAYMENT_ERRORS, switchToBankTransfer } from "@/lib/payments"

export function OrderConfirmationPage() {
  const { orderNumber } = useParams()
  const [params, setParams] = useSearchParams()
  const token = params.get("token") ?? (orderNumber ? rememberedToken(orderNumber) : null)
  const { data: order, isLoading, error } = useOrder(orderNumber, token)
  const { user } = useAuth()
  const { data: returns = [] } = useOrderReturns(order?.id, !!user)
  useTitle(order ? `Order ${order.order_number}` : "Your order")
  const cardReturn = params.get("card") // "return" | "cancelled" | "failed" — how the customer got here
  const confirming = useCardCheck(order, token, cardReturn === "return")

  // Signed in and looking at their own order: the key to it doesn't need to stay
  // in the address bar (and the browser's history) of a device others may use.
  const { data: withoutKey } = useOrder(user && params.get("token") ? orderNumber : undefined, null)
  const ownOrder = !!user && !!withoutKey
  useEffect(() => {
    if (!ownOrder || !params.get("token")) return
    const rest = new URLSearchParams(params)
    rest.delete("token")
    setParams(rest, { replace: true })
  }, [ownOrder, params, setParams])

  if (isLoading) return <div className="container-shop min-h-[60vh]" />

  // A failed refresh (e.g. offline) still shows the order if it's saved on the device.
  if (!order) {
    void error
    return (
      <div className="container-shop flex min-h-[60vh] flex-col items-start justify-center py-24">
        <p className="eyebrow">Order {orderNumber}</p>
        <h1 className="mt-4 text-5xl font-light">We couldn't open this order.</h1>
        <p className="mt-4 max-w-md text-muted-foreground">
          Use the link from the page you saw after ordering, or sign in to the account you ordered with.
        </p>
        <Button asChild size="lg" className="mt-10 h-12 rounded-none px-8">
          <Link to="/login">Sign in</Link>
        </Button>
      </div>
    )
  }

  const firstName = order.full_name.split(" ")[0]
  const awaiting = order.status === "awaiting_payment"
  const card = order.payment_method === "card"
  const returnInfo = returnWindow(order)
  const canReturn =
    !!user && order.is_account_order && returnInfo.open && order.items.some((i) => returnableQuantity(i, returns) > 0)

  return (
    <div className="container-shop pt-14 md:pt-20">
      <div className="max-w-3xl">
        <p className="eyebrow">Order {order.order_number}</p>
        <h1 className="mt-4 text-5xl leading-tight font-light md:text-6xl">
          {order.status === "cancelled" ? "This order was cancelled." : `Thank you, ${firstName}.`}
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
          {awaiting && !card && (
            <>
              Your order is placed and your pieces are set aside for you
              {order.payment_due_at && <> until {dateLong(order.payment_due_at)}</>}. It will be on its way as soon as
              your bank transfer arrives.
            </>
          )}
          {awaiting && card && (confirming ? <>We're confirming your card payment…</> : <>Your order is placed, but it isn't paid yet.</>)}
          {order.status === "paid" &&
            (card ? (
              <>Your card payment went through — we're preparing your parcel. A confirmation is on its way to {order.email}.</>
            ) : (
              <>Your payment has arrived — we're preparing your parcel.</>
            ))}
          {order.status === "shipped" && (
            <>
              Your parcel is on its way.
              {order.tracking_number && (
                <>
                  {" "}
                  Tracking number: <span className="font-mono text-foreground">{order.tracking_number}</span>
                </>
              )}
            </>
          )}
          {order.status === "delivered" && (
            <>
              Delivered{order.delivered_at && <> on {dateLong(order.delivered_at)}</>}. We hope you love it.
              {returnInfo.until && returnInfo.open && order.is_account_order && (
                <> If something isn't right, you can request a return until {dateLong(returnInfo.until)}.</>
              )}
            </>
          )}
          {order.status === "cancelled" &&
            (card && order.refunded_cents > 0 ? (
              <>
                Your card payment of {formatPrice(order.refunded_cents)} has been sent back to your card — it usually
                shows within a few working days. Nothing will be sent. If this comes as a surprise, please get in touch
                with us.
              </>
            ) : order.cancel_reason === "not_paid" && card ? (
              <>
                The card payment wasn't finished, so the order was cancelled and the pieces went back on the shelf.
                Nothing was taken from your card. If you still want them, you're welcome to order again.
              </>
            ) : order.cancel_reason === "not_paid" ? (
              <>
                We didn't receive the payment
                {order.payment_due_at && <> by {dateLong(order.payment_due_at)}</>}, so the order was cancelled and the
                pieces were released. If you still want them, you're welcome to order again.
              </>
            ) : card ? (
              <>We've cancelled this order. Nothing has been taken from your card. If this comes as a surprise, please get in touch with us.</>
            ) : order.paid_at ? (
              <>
                We've cancelled this order and will return the {formatPrice(order.total_cents)} you paid to the account
                it came from. If this comes as a surprise, please get in touch with us.
              </>
            ) : (
              <>
                We've cancelled this order — please don't send the payment for it. If you already have, write to us and
                we'll send it straight back.
              </>
            ))}
        </p>
      </div>

      <StatusTimeline order={order} />

      {(canReturn || returns.length > 0) && (
        <section className="mt-10 max-w-3xl space-y-3">
          {returns.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 bg-linen px-5 py-4 text-sm">
              <span>
                Return {r.return_number} · {dateLong(r.created_at)}
                {r.shop_note && <span className="block text-muted-foreground">From Nordaloom: {r.shop_note}</span>}
              </span>
              <ReturnBadge status={r.status} />
            </div>
          ))}
          {canReturn && (
            <Button asChild className="h-11 rounded-none px-6">
              <Link to={`/account/orders/${order.order_number}/return`}>
                <RotateCcw className="size-4" /> Request a return
              </Link>
            </Button>
          )}
        </section>
      )}

      <div className="mt-14 grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-7">
          {awaiting && !card && <PaymentInstructions order={order} />}
          {awaiting && card && <CardPayment order={order} token={token} confirming={confirming} reason={cardReturn} />}
          {card && order.status !== "awaiting_payment" && order.status !== "cancelled" && (
            <p className="mb-10 inline-flex items-center gap-2 border px-4 py-2 text-sm">
              <CreditCard className="size-4" strokeWidth={1.5} /> Paid with {cardLabel(order.card_brand, order.card_last4)}
            </p>
          )}

          <section className={cn(awaiting && "mt-14")}>
            <h2 className="text-2xl">What you ordered</h2>
            <ul className="mt-6 divide-y border-y">
              {order.items.map((i) => (
                <li key={i.id} className="flex gap-5 py-5">
                  <Link to={`/product/${i.product_slug}`} className="block aspect-[4/5] w-20 shrink-0 overflow-hidden bg-muted">
                    <ProductImage
                      product={{
                        slug: i.product_slug,
                        category_slug: "",
                        name: i.product_name,
                        images: i.product_image ? [i.product_image] : [],
                        colours: [],
                      }}
                    />
                  </Link>
                  <div className="flex-1 text-sm">
                    <p className="font-medium">{i.product_name}</p>
                    <p className="mt-1 text-muted-foreground">
                      {i.colour}
                      {i.size !== "One size" && <> · {i.size}</>} · Qty {i.quantity}
                    </p>
                  </div>
                  <p className="text-sm tabular-nums">{formatPrice(i.line_total_cents)}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-5 ml-auto max-w-xs space-y-2 text-sm">
              <Row label="Subtotal" value={formatPrice(order.subtotal_cents)} />
              {order.discount_cents > 0 && <Row label={`Discount · ${order.discount_code}`} value={`−${formatPrice(order.discount_cents)}`} />}
              <Row label="Delivery" value={order.shipping_cents === 0 ? "Free" : formatPrice(order.shipping_cents)} />
              <div className="flex items-baseline justify-between border-t pt-3">
                <dt className="font-medium">Total</dt>
                <dd className="font-serif text-2xl tabular-nums">{formatPrice(order.total_cents)}</dd>
              </div>
              <Row label="Includes 21% VAT" value={formatPrice(order.vat_cents)} muted />
            </dl>
          </section>
        </div>

        <aside className="space-y-6 lg:col-span-5">
          <div className="bg-linen p-7">
            <h2 className="text-xl">Delivery</h2>
            <p className="mt-3 text-sm font-medium">{order.shipping_label}</p>
            {order.parcel_locker && <p className="mt-1 text-sm">Locker: {order.parcel_locker}</p>}
            <address className="mt-4 text-sm leading-relaxed text-muted-foreground not-italic">
              {order.full_name}
              <br />
              {order.address_line1}
              {order.address_line2 && (
                <>
                  <br />
                  {order.address_line2}
                </>
              )}
              <br />
              {order.postal_code} {order.city}
              <br />
              {countryName(order.country)}
            </address>
          </div>
          <div className="bg-linen p-7">
            <h2 className="text-xl">Contact</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {order.email}
              <br />
              {order.phone}
            </p>
          </div>
          <div className="border p-7 text-sm leading-relaxed text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Keep this page.</span> Bookmark it or save your order
              number, <span className="font-medium text-foreground">{order.order_number}</span>
              {!card && <> — it's also your payment reference</>}. This page always shows the latest status of your order.
            </p>
          </div>
          <Link to="/shop" className="inline-block py-2 text-sm underline underline-offset-4">
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  )
}

// A time of day within the next hour, so in the customer's own time (dates are in the shop's: see dateLong).
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })

/**
 * Back from Stripe's page: asks the shop to check with Stripe until the order
 * shows as paid (usually at once). Otherwise checks quietly once.
 */
function useCardCheck(order: Order | null | undefined, token: string | null, justPaid: boolean) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(justPaid)
  const started = useRef(false)
  // Waiting for the payment — or an order that was cancelled while it still had a payment page
  // on record: the shop then makes sure that a payment, if one went through after all, is sent
  // back (once the page is known closed and unpaid it goes off the record, and this stops).
  const pending =
    !!order &&
    order.payment_method === "card" &&
    !!order.stripe_session_id &&
    (order.status === "awaiting_payment" || (order.status === "cancelled" && order.refunded_cents === 0))

  useEffect(() => {
    if (!order || started.current) return
    if (!pending) {
      setConfirming(false)
      return
    }
    started.current = true
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < (justPaid ? 10 : 1); i++) {
        const r = await checkCardPayment(order.order_number, token)
        if (cancelled) return
        if (r.ok && r.data.status !== "awaiting_payment") break
        if (justPaid) await new Promise((res) => setTimeout(res, 2000))
      }
      await queryClient.invalidateQueries({ queryKey: ["order", order.order_number] })
      if (!cancelled) setConfirming(false)
    })()
    return () => {
      cancelled = true
    }
  }, [order, pending, token, justPaid, queryClient])

  return confirming && pending
}

function CardPayment({ order, token, confirming, reason }: { order: Order; token: string | null; confirming: boolean; reason: string | null }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<"card" | "bank" | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (confirming) {
    return (
      <section className="flex items-center gap-4 border border-foreground p-6 sm:p-8" role="status">
        <Loader2 className="size-5 animate-spin" />
        <p>Confirming your payment with the bank — this only takes a moment.</p>
      </section>
    )
  }

  async function payByCard() {
    setBusy("card")
    setError(null)
    const r = await goToCardPayment(order.order_number, token)
    if (!r.ok) {
      setBusy(null)
      setError(PAYMENT_ERRORS[r.code] ?? "The payment page didn't open. Please try again, or pay by bank transfer instead.")
      void queryClient.invalidateQueries({ queryKey: ["order", order.order_number] })
    }
  }

  async function payByBank() {
    setBusy("bank")
    setError(null)
    const r = await switchToBankTransfer(order.order_number, token)
    setBusy(null)
    if (!r.ok) setError(PAYMENT_ERRORS[r.code] ?? "That didn't work. Please try again.")
    void queryClient.invalidateQueries({ queryKey: ["order", order.order_number] })
  }

  const until = order.payment_due_at ? new Date(order.payment_due_at) : null
  return (
    <section className="border border-foreground p-6 sm:p-8">
      <p className="eyebrow text-clay">What to do next</p>
      <h2 className="mt-3 text-3xl">{reason === "cancelled" || reason === "failed" || order.stripe_session_id ? "Your payment isn't finished" : "Pay by card"}</h2>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        {reason === "failed"
          ? "The payment page didn't open."
          : reason === "cancelled"
            ? "You left the payment page before paying — nothing has been taken from your card."
            : "We haven't received a card payment for this order yet."}{" "}
        We're holding your pieces{until && <> until {time.format(until)}</>}; after that the order is cancelled and they go back on
        the shelf.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={payByCard} disabled={!!busy} className="h-12 rounded-none px-6">
          {busy === "card" ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />} Pay {formatPrice(order.total_cents)} by card
        </Button>
        <Button onClick={payByBank} disabled={!!busy} variant="outline" className="h-12 rounded-none bg-transparent px-6">
          {busy === "bank" ? <Loader2 className="size-4 animate-spin" /> : <Landmark className="size-4" />} Pay by bank transfer instead
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        With bank transfer you'll see our bank details here, and we hold your pieces for a few more days while the transfer arrives.
      </p>
      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function PaymentInstructions({ order }: { order: Order }) {
  return (
    <section className="border border-foreground p-6 sm:p-8">
      <p className="eyebrow text-clay">What to do next</p>
      <h2 className="mt-3 text-3xl">Pay by bank transfer</h2>
      <ol className="mt-6 space-y-3 text-sm leading-relaxed">
        <li className="flex gap-3">
          <span className="font-serif text-clay">1</span> Open your online bank and make a transfer to the account below.
        </li>
        <li className="flex gap-3">
          <span className="font-serif text-clay">2</span>
          <span>
            Write <span className="font-medium">{order.payment_reference}</span> as the payment reference, so we can
            match your payment to your order.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-serif text-clay">3</span>
          <span>
            {order.payment_due_at ? (
              <>
                Please pay by <span className="font-medium">{dateLong(order.payment_due_at)}</span>. If the payment
                hasn't arrived by then, the order is cancelled automatically and the pieces are released.
              </>
            ) : (
              <>We'll send your parcel as soon as the payment arrives.</>
            )}{" "}
            This page shows when it's been received.
          </span>
        </li>
      </ol>

      <dl className="mt-8 divide-y border-y text-sm">
        <CopyRow label="Recipient" value={order.bank.recipient} />
        <CopyRow label="IBAN" value={order.bank.iban} copyValue={order.bank.iban.replace(/\s/g, "")} mono />
        {order.bank.bic && <CopyRow label="BIC / SWIFT" value={order.bank.bic} mono />}
        {order.bank.bank_name && <CopyRow label="Bank" value={order.bank.bank_name} />}
        <CopyRow label="Payment reference" value={order.payment_reference} mono strong />
        <CopyRow label="Amount" value={formatPrice(order.total_cents)} copyValue={(order.total_cents / 100).toFixed(2)} strong />
        {order.payment_due_at && <CopyRow label="Pay by" value={dateLong(order.payment_due_at)} />}
      </dl>
    </section>
  )
}

function CopyRow({ label, value, copyValue, mono, strong }: { label: string; value: string; copyValue?: string; mono?: boolean; strong?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-4 py-3">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("flex-1 break-all", mono && "font-mono tracking-tight", strong && "font-semibold")}>{value}</dd>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(copyValue ?? value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check className="size-3.5 text-moss" /> : <Copy className="size-3.5" />}
        <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  )
}

function StatusTimeline({ order }: { order: Order }) {
  if (order.status === "cancelled") {
    return (
      <p className="mt-10 inline-flex items-center gap-2 border px-4 py-2 text-sm">
        <X className="size-4" /> {STATUS_LABEL.cancelled}
      </p>
    )
  }
  const steps = [
    { key: "placed", label: "Order placed", done: true, icon: Check },
    { key: "paid", label: "Payment received", done: order.status !== "awaiting_payment", icon: Package },
    { key: "shipped", label: "On its way", done: order.status === "shipped" || order.status === "delivered", icon: Truck },
    { key: "delivered", label: "Delivered", done: order.status === "delivered", icon: Home },
  ]
  return (
    <ol className="mt-10 flex max-w-3xl items-center gap-3 text-sm">
      {steps.map((s, i) => (
        <li key={s.key} className="flex flex-1 items-center gap-3">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full border",
              s.done ? "border-foreground bg-foreground text-background" : "border-input text-muted-foreground",
            )}
          >
            <s.icon className="size-4" />
          </span>
          <span className={cn("hidden sm:inline", !s.done && "text-muted-foreground")}>{s.label}</span>
          {i < steps.length - 1 && <span className={cn("h-px flex-1", steps[i + 1].done ? "bg-foreground" : "bg-border")} />}
        </li>
      ))}
    </ol>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between", muted && "text-xs text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
