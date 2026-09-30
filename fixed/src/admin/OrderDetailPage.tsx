import { useEffect, useState, type ReactNode } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowUpRight, Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProductImage } from "@/components/art/ProductImage"
import { ReturnBadge, StatusBadge } from "@/components/Badges"
import { dateTime, setOrderStatus, useAdminOrder, type AdminOrderDetail } from "@/lib/admin"
import { countryName, STATUS_LABEL, useShopSettings, type OrderStatus } from "@/lib/checkout"
import { reasonLabel } from "@/lib/account"
import { formatPrice } from "@/lib/format"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, Panel } from "./ui"
import { cancelAndRefundCardOrder, cardLabel } from "@/lib/payments"
import { OrderEmails } from "./EmailsPage"

export function OrderDetailPage() {
  const { orderNumber } = useParams()
  const { data: order, isLoading } = useAdminOrder(orderNumber)
  useTitle(orderNumber ? `Order ${orderNumber}` : "Order")

  if (isLoading) return <Empty>Loading…</Empty>
  if (!order) return <Empty>There's no order {orderNumber}.</Empty>

  return (
    <div className="space-y-8">
      <Link to="/admin/orders" className="-my-2 inline-flex items-center gap-1 py-2.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Orders
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Placed {dateTime.format(new Date(order.created_at))}</p>
          <h1 className="mt-3 flex flex-wrap items-center gap-4 text-4xl font-light md:text-5xl">
            {order.order_number} <StatusBadge status={order.status} />
          </h1>
        </div>
        <Link to={`/order/${order.order_number}`} className="text-sm underline underline-offset-4">
          See the customer's page
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <NextStep order={order} />

          <Panel title="Pieces">
            <ul className="divide-y">
              {order.order_items.map((i) => (
                <li key={i.id} className="flex items-center gap-4 py-3">
                  <span className="block aspect-[4/5] w-14 shrink-0 overflow-hidden bg-muted">
                    <ProductImage product={{ slug: i.product_slug, category_slug: "", name: i.product_name, images: i.product_image ? [i.product_image] : [], colours: [] }} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-medium">{i.product_name}</span>
                    <span className="text-muted-foreground">
                      {i.colour}
                      {i.size !== "One size" && <> · {i.size}</>} · {formatPrice(i.unit_price_cents)} × {i.quantity}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">{formatPrice(i.line_total_cents)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 ml-auto max-w-64 space-y-1.5 border-t pt-4 text-sm">
              <Row label="Subtotal" value={formatPrice(order.subtotal_cents)} />
              {order.discount_cents > 0 && <Row label={`Discount · ${order.discount_code}`} value={`−${formatPrice(order.discount_cents)}`} />}
              <Row label={`Delivery · ${order.shipping_label}`} value={order.shipping_cents === 0 ? "Free" : formatPrice(order.shipping_cents)} />
              <div className="flex justify-between border-t pt-2 text-base font-medium">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPrice(order.total_cents)}</dd>
              </div>
              <Row label="incl. VAT" value={formatPrice(order.vat_cents)} muted />
            </dl>
          </Panel>

          {order.returns.length > 0 && (
            <Panel title="Returns" action={<Link to="/admin/returns?status=all" className="text-sm underline underline-offset-4">All returns</Link>}>
              <ul className="divide-y">
                {order.returns.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <span>
                      <span className="font-medium">{r.return_number}</span> · {reasonLabel(r.reason)}
                      <span className="block text-muted-foreground">
                        {r.return_items
                          .map((ri) => {
                            const it = order.order_items.find((i) => i.id === ri.order_item_id)
                            return it ? `${it.product_name}${ri.quantity > 1 ? ` ×${ri.quantity}` : ""}` : ""
                          })
                          .join(", ")}
                      </span>
                    </span>
                    <ReturnBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Customer">
            <p className="text-sm font-medium">{order.full_name}</p>
            <p className="mt-1 text-sm">
              <a href={`mailto:${order.email}`} className="underline underline-offset-4">
                {order.email}
              </a>
            </p>
            <p className="mt-1 text-sm">{order.phone}</p>
            <p className="mt-3 text-xs text-muted-foreground">{order.user_id ? "Ordered with an account" : "Ordered as a guest"}</p>
            <Link to={`/admin/customers/${encodeURIComponent(order.email.toLowerCase())}`} className="mt-3 inline-block text-sm underline underline-offset-4">
              All their orders
            </Link>
          </Panel>

          <Panel title="Ship to" action={<CopyButton text={addressText(order)} />}>
            <p className="text-sm font-medium">{order.shipping_label}</p>
            {order.parcel_locker && <p className="mt-1 text-sm">Locker: {order.parcel_locker}</p>}
            <address className="mt-3 text-sm leading-relaxed whitespace-pre-line text-muted-foreground not-italic">{addressText(order)}</address>
          </Panel>

          <PaymentPanel order={order} />

          <Panel title="Emails">
            <OrderEmails orderId={order.id} />
          </Panel>

          <Panel title="History">
            <ol className="space-y-3 text-sm">
              <Event done label="Placed" at={order.created_at} />
              {order.status !== "cancelled" || order.paid_at ? <Event done={!!order.paid_at} label="Paid" at={order.paid_at} /> : null}
              {order.status !== "cancelled" && (
                <>
                  <Event done={!!order.shipped_at} label="Shipped" at={order.shipped_at} extra={order.tracking_number && <span className="font-mono">{order.tracking_number}</span>} />
                  <Event done={!!order.delivered_at} label="Delivered" at={order.delivered_at} />
                </>
              )}
              {order.cancelled_at && (
                <Event
                  done
                  label={
                    order.cancel_reason === "not_paid"
                      ? order.payment_method === "card"
                        ? "Cancelled — card payment not finished"
                        : "Cancelled — not paid in time"
                      : "Cancelled by you"
                  }
                  at={order.cancelled_at}
                />
              )}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  )
}

/** The one thing to do next with this order, front and centre. */
function NextStep({ order }: { order: AdminOrderDetail }) {
  const queryClient = useQueryClient()
  const { data: settings } = useShopSettings()
  const [tracking, setTracking] = useState(order.tracking_number)
  useEffect(() => setTracking(order.tracking_number), [order.tracking_number])
  const pieces = order.order_items.reduce((n, i) => n + i.quantity, 0)

  const update = useMutation({
    mutationFn: ({ status, tracking }: { status: OrderStatus | "tracking"; tracking?: string }) => setOrderStatus(order.id, status, tracking),
    onSuccess: (_d, { status }) => {
      toast.success(status === "tracking" ? "Tracking number saved." : `${order.order_number} marked as ${STATUS_LABEL[status].toLowerCase()}.`)
      for (const key of ["admin-order", "admin-orders", "admin-order-counts", "admin-dashboard", "admin-waiting", "admin-products", "products", "product", "admin-emails"]) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
    onError: () => toast.error("That didn't work — please refresh and try again."),
  })

  const paidByCard = order.payment_method === "card" && order.status === "paid"
  // An unpaid card order that has had a payment page is cancelled through the payment function:
  // it asks Stripe first, closes the page if it is open, and refunds the payment if there is one
  // the shop hasn't heard of. Only if Stripe can't be asked at all and the order's deadline has
  // passed (no page can be open then) is the order cancelled without it.
  const hasPaymentPage = order.payment_method === "card" && order.status === "awaiting_payment" && !!order.stripe_session_id
  const pastDeadline = !!order.payment_due_at && new Date(order.payment_due_at) < new Date()
  const paidByTransfer = order.payment_method === "bank_transfer" && order.status === "paid"
  const refundable = order.total_cents - order.refunded_cents
  const cancelCard = useMutation({
    mutationFn: async () => {
      const r = await cancelAndRefundCardOrder(order.id)
      if (r.ok) return { ...r.data, unchecked: false }
      // Stripe couldn't be asked at all (not set up, not answering): the only case for a plain cancel.
      const stripeUnreachable = /^Stripe:|aren't set up|unreachable|server_error/.test(r.code) && !/close the payment page/.test(r.code)
      if (hasPaymentPage && pastDeadline && stripeUnreachable) {
        await setOrderStatus(order.id, "cancelled")
        return { refunded: 0, unchecked: true }
      }
      throw new Error(r.code)
    },
    onSuccess: (d) => {
      toast.success(
        d.refunded > 0
          ? `${order.order_number} cancelled, and ${formatPrice(d.refunded)} refunded to the card.`
          : d.unchecked
            ? `${order.order_number} cancelled. Stripe couldn't be asked about it; if a payment turns up, it is refunded by itself.`
            : `${order.order_number} cancelled. Nothing was paid, and its payment page is closed.`,
      )
      for (const key of ["admin-order", "admin-orders", "admin-order-counts", "admin-dashboard", "admin-waiting", "admin-products", "products", "product", "admin-emails"]) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
    onError: (e) => {
      // whatever happened, the order on screen may be out of date now
      void queryClient.invalidateQueries({ queryKey: ["admin-order"] })
      toast.error(
        paidByCard
          ? `The refund didn't go through (${e.message}). Nothing was changed — please try again.`
          : e.message === "not_a_card_order"
            ? "The customer has just switched this order to bank transfer. Refresh the page and cancel it again."
            : e.message === "card_refund_needed" || e.message === "not_refundable"
              ? "The payment has just arrived, so the order is paid now. Refresh the page, then use \u201cCancel and refund\u201d."
              : /close the payment page/.test(e.message)
                ? "Stripe didn't close the payment page, so the order wasn't cancelled. Please try again in a moment."
                : `The order wasn't cancelled: Stripe couldn't be asked about it (${e.message.replace(/^Stripe:\s*/, "")}). Please try again in a moment.`,
      )
    },
  })

  const cancel = () => {
    const back = `${pieces === 1 ? "Its piece goes" : `Its ${pieces} pieces go`} back into stock.`
    if (paidByCard) {
      if (window.confirm(`Cancel ${order.order_number} and refund ${formatPrice(refundable)} to the customer's card? ${back}`)) cancelCard.mutate()
      return
    }
    const owed = paidByTransfer
      ? ` The customer has paid ${formatPrice(refundable)} by bank transfer: the email will tell them it is being sent back, so make that transfer from your bank.`
      : ""
    if (window.confirm(`Cancel ${order.order_number}?${owed} ${back}`)) {
      if (hasPaymentPage) cancelCard.mutate()
      else update.mutate({ status: "cancelled" })
    }
  }
  const cancelButton = (
    <Button variant="ghost" className="h-11 rounded-none text-muted-foreground" disabled={update.isPending || cancelCard.isPending} onClick={cancel}>
      {cancelCard.isPending ? (paidByCard ? "Refunding…" : "Cancelling…") : paidByCard ? "Cancel and refund" : "Cancel order"}
    </Button>
  )

  let body: ReactNode
  switch (order.status) {
    case "awaiting_payment": {
      const due = order.payment_due_at ? new Date(order.payment_due_at) : null
      if (order.payment_method === "card") {
        body = (
          <>
            <Title>Waiting for the card payment</Title>
            <p className="mt-2 text-sm text-muted-foreground">
              {order.stripe_session_id
                ? "The customer was sent to Stripe's payment page. As soon as they pay, this order is marked paid by itself and they get the “payment received” email."
                : "The payment page hasn't been opened yet."}
              {due && (
                <>
                  {" "}
                  If nothing is paid by <span className="text-foreground">{dateTime.format(due)}</span>, the order cancels itself and the pieces go back into
                  stock.
                </>
              )}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">{cancelButton}</div>
          </>
        )
        break
      }
      body = (
        <>
          <Title>Waiting for the bank transfer</Title>
          <p className="mt-2 text-sm text-muted-foreground">
            Look for <span className="font-mono text-foreground">{order.payment_reference}</span> and{" "}
            <span className="text-foreground">{formatPrice(order.total_cents)}</span> in your bank.
            {due && (
              <>
                {" "}
                Due <span className={cn(due < new Date() ? "text-destructive" : "text-foreground")}>{dateTime.format(due)}</span> — after that it
                cancels itself.
              </>
            )}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button className="h-11 rounded-none px-6" disabled={update.isPending} onClick={() => update.mutate({ status: "paid" })}>
              Payment received
            </Button>
            {cancelButton}
          </div>
        </>
      )
      break
    }
    case "paid":
      body = (
        <>
          <Title>Ready to ship</Title>
          <p className="mt-2 text-sm text-muted-foreground">Add the tracking number (optional) — the customer will see it on their order page.</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking number" maxLength={100} className="h-11 w-64 rounded-none bg-background font-mono" />
            <Button className="h-11 rounded-none px-6" disabled={update.isPending} onClick={() => update.mutate({ status: "shipped", tracking })}>
              Mark as shipped
            </Button>
            {cancelButton}
          </div>
        </>
      )
      break
    case "shipped":
      body = (
        <>
          <Title>On its way</Title>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking number" maxLength={100} className="h-11 w-64 rounded-none bg-background font-mono" />
            <Button
              variant="outline"
              className="h-11 rounded-none bg-transparent"
              disabled={update.isPending || tracking.trim() === order.tracking_number}
              onClick={() => update.mutate({ status: "tracking", tracking })}
            >
              Save tracking
            </Button>
          </div>
          <div className="mt-4">
            <Button className="h-11 rounded-none px-6" disabled={update.isPending} onClick={() => update.mutate({ status: "delivered" })}>
              Mark as delivered
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">The {settings?.return_days ?? 14}-day return period starts when you mark it delivered.</p>
          </div>
        </>
      )
      break
    case "delivered": {
      const until = order.delivered_at ? new Date(new Date(order.delivered_at).getTime() + (settings?.return_days ?? 14) * 86_400_000) : null
      body = (
        <>
          <Title>Delivered</Title>
          <p className="mt-2 text-sm text-muted-foreground">
            {order.delivered_at && <>Delivered {dateTime.format(new Date(order.delivered_at))}. </>}
            {until && (until > new Date() ? <>Returns can be requested until {dateTime.format(until)}.</> : <>The return period has ended.</>)}
          </p>
        </>
      )
      break
    }
    case "cancelled":
      body = (
        <>
          <Title>Cancelled</Title>
          <p className="mt-2 text-sm text-muted-foreground">
            {order.cancel_reason === "not_paid"
              ? order.payment_method === "card"
                ? "The customer didn't finish the card payment, so nothing was charged."
                : "The payment didn't arrive by the due date."
              : "You cancelled this order."}{" "}
            Its pieces went back into stock.
            {order.refunded_cents > 0 && <> {formatPrice(order.refunded_cents)} was refunded to the card.</>}
            {order.cancel_reason === "by_shop" && order.payment_method === "bank_transfer" && order.paid_at && order.refunded_cents < order.total_cents && (
              <span className="mt-2 block text-foreground">
                The customer had paid {formatPrice(order.total_cents - order.refunded_cents)} by bank transfer and was told it is being sent back. Make
                that transfer from your bank if you haven't yet.
              </span>
            )}
          </p>
        </>
      )
  }

  return <section className={cn("border p-6", order.status === "paid" || order.status === "awaiting_payment" ? "border-clay/40 bg-clay/5" : "bg-card")}>{body}</section>
}

function PaymentPanel({ order }: { order: AdminOrderDetail }) {
  const card = order.payment_method === "card"
  const stripeUrl = order.stripe_payment_intent
    ? `https://dashboard.stripe.com/${order.stripe_livemode ? "" : "test/"}payments/${order.stripe_payment_intent}`
    : null
  return (
    <Panel title="Payment">
      <dl className="space-y-2 text-sm">
        <Row label="Method" value={card ? "Card (Stripe)" : "Bank transfer"} />
        {card && order.card_last4 && <Row label="Card" value={cardLabel(order.card_brand, order.card_last4)} />}
        {!card && <Row label="Reference" value={order.payment_reference} />}
        {order.refunded_cents > 0 && <Row label={card ? "Refunded to card" : "Refunded"} value={formatPrice(order.refunded_cents)} />}
      </dl>
      {stripeUrl && (
        <a href={stripeUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm underline underline-offset-4">
          See it in Stripe <ArrowUpRight className="size-3.5" />
        </a>
      )}
    </Panel>
  )
}

function Title({ children }: { children: ReactNode }) {
  return <h2 className="text-2xl">{children}</h2>
}

function Event({ done, label, at, extra }: { done: boolean; label: string; at: string | null; extra?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cn("mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border", done ? "border-foreground bg-foreground text-background" : "border-input")}>
        {done && <Check className="size-2.5" />}
      </span>
      <span className={cn(!done && "text-muted-foreground")}>
        {label}
        {at && <span className="block text-xs text-muted-foreground">{dateTime.format(new Date(at))}</span>}
        {extra && <span className="block text-xs">{extra}</span>}
      </span>
    </li>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", muted && "text-xs text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

function addressText(o: AdminOrderDetail) {
  return [o.full_name, o.address_line1, o.address_line2, `${o.postal_code} ${o.city}`, countryName(o.country), o.phone].filter(Boolean).join("\n")
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
      className="-my-2 flex items-center gap-1 px-1 py-2.5 text-xs text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-moss" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
    </button>
  )
}
