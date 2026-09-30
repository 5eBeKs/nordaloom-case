import { Link } from "react-router-dom"
import { ArrowRight, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductImage } from "@/components/art/ProductImage"
import { useAuth } from "@/context/AuthContext"
import { formatPrice } from "@/lib/format"
import { useShopSettings, type OrderItem } from "@/lib/checkout"
import {
  dateLong,
  reasonLabel,
  RETURN_STATUS_LABEL,
  returnableQuantity,
  useMyOrders,
  type AccountOrder,
  type ReturnRequest,
} from "@/lib/account"
import { useTitle } from "@/hooks/use-title"
import { ReturnBadge, StatusBadge } from "@/components/Badges"

export function AccountOrdersPage() {
  useTitle("Your orders")
  const { user } = useAuth()
  const { data: orders, isLoading } = useMyOrders(user?.id)
  const { data: settings } = useShopSettings()

  if (isLoading || !orders) return <p className="py-10 text-muted-foreground">Loading your orders…</p>

  if (orders.length === 0) {
    return (
      <div className="max-w-lg py-6">
        <p className="text-lg text-muted-foreground">You haven't ordered anything yet.</p>
        <p className="mt-2 text-sm text-muted-foreground">Orders you place while signed in will appear here.</p>
        <Button asChild size="lg" className="mt-8 h-12 rounded-none px-8">
          <Link to="/shop">Browse the shop</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} returnDays={settings?.return_days ?? 14} returnAddress={settings?.return_address ?? ""} />
      ))}
    </div>
  )
}

function OrderCard({ order, returnDays, returnAddress }: { order: AccountOrder; returnDays: number; returnAddress: string }) {
  const returnUntil = order.delivered_at ? new Date(new Date(order.delivered_at).getTime() + returnDays * 86_400_000) : null
  const windowOpen = order.status === "delivered" && !!returnUntil && returnUntil.getTime() > Date.now()
  const canReturn = windowOpen && order.order_items.some((i) => returnableQuantity(i, order.returns) > 0)

  return (
    <article className="border">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <Link to={`/order/${order.order_number}`} className="font-serif text-xl hover:underline">
            {order.order_number}
          </Link>
          <span className="text-sm text-muted-foreground">Placed {dateLong(order.created_at)}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-right text-sm tabular-nums">
            {formatPrice(order.total_cents)}
            {order.discount_cents > 0 && (
              <span className="block text-xs text-moss">
                {order.discount_code} −{formatPrice(order.discount_cents)}
              </span>
            )}
          </span>
          <StatusBadge status={order.status} />
        </div>
      </header>

      <div className="px-5 py-5 sm:px-6">
        <StatusLine order={order} returnUntil={returnUntil} windowOpen={windowOpen} />

        <ul className="mt-5 divide-y">
          {order.order_items.map((i) => (
            <ItemRow key={i.id} item={i} returns={order.returns} />
          ))}
        </ul>

        {order.returns.length > 0 && (
          <div className="mt-6 space-y-3">
            {order.returns.map((r) => (
              <ReturnSummary key={r.id} ret={r} items={order.order_items} returnAddress={returnAddress} />
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm" className="rounded-none bg-transparent">
            <Link to={`/order/${order.order_number}`}>
              {order.status === "awaiting_payment" ? "Payment details" : "View order"} <ArrowRight className="size-3.5" />
            </Link>
          </Button>
          {canReturn && (
            <Button asChild size="sm" className="rounded-none">
              <Link to={`/account/orders/${order.order_number}/return`}>
                <RotateCcw className="size-3.5" /> Request a return
              </Link>
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

function StatusLine({ order, returnUntil, windowOpen }: { order: AccountOrder; returnUntil: Date | null; windowOpen: boolean }) {
  let text: React.ReactNode = null
  switch (order.status) {
    case "awaiting_payment":
      text = (
        <>
          {order.payment_method === "card" ? "Card payment not finished" : "Waiting for your bank transfer"}
          {order.payment_method !== "card" && order.payment_due_at && (
            <>
              {" "}
              — please pay by <span className="font-medium text-foreground">{dateLong(order.payment_due_at)}</span>
            </>
          )}
          .
        </>
      )
      break
    case "paid":
      text = "Payment received — we're preparing your parcel."
      break
    case "shipped":
      text = (
        <>
          On its way since {dateLong(order.shipped_at ?? order.created_at)}.
          {order.tracking_number && (
            <>
              {" "}
              Tracking number: <span className="font-mono text-foreground">{order.tracking_number}</span>
            </>
          )}
        </>
      )
      break
    case "delivered":
      text = (
        <>
          Delivered {order.delivered_at && dateLong(order.delivered_at)}.{" "}
          {returnUntil &&
            (windowOpen ? (
              <>
                You can request a return until <span className="font-medium text-foreground">{dateLong(returnUntil)}</span>.
              </>
            ) : (
              <>The return period ended on {dateLong(returnUntil)}.</>
            ))}
        </>
      )
      break
    case "cancelled":
      text = order.cancel_reason === "not_paid" ? "Cancelled — the payment didn't arrive in time." : "Cancelled."
      break
  }
  return <p className="text-sm text-muted-foreground">{text}</p>
}

function ItemRow({ item, returns }: { item: OrderItem; returns: ReturnRequest[] }) {
  const inReturns = returns.filter((r) => r.return_items.some((ri) => ri.order_item_id === item.id))
  return (
    <li className="flex gap-4 py-4">
      <Link to={`/product/${item.product_slug}`} className="block aspect-[4/5] w-16 shrink-0 overflow-hidden bg-muted">
        <ProductImage
          product={{ slug: item.product_slug, category_slug: "", name: item.product_name, images: item.product_image ? [item.product_image] : [], colours: [] }}
        />
      </Link>
      <div className="min-w-0 flex-1 text-sm">
        <Link to={`/product/${item.product_slug}`} className="font-medium hover:underline">
          {item.product_name}
        </Link>
        <p className="mt-0.5 text-muted-foreground">
          {item.colour}
          {item.size !== "One size" && <> · {item.size}</>} · Qty {item.quantity}
        </p>
        {inReturns.map((r) => (
          <p key={r.id} className="mt-1 text-xs text-clay">
            {RETURN_STATUS_LABEL[r.status]} · {r.return_number}
          </p>
        ))}
      </div>
      <p className="text-sm tabular-nums">{formatPrice(item.line_total_cents)}</p>
    </li>
  )
}

function ReturnSummary({ ret, items, returnAddress }: { ret: ReturnRequest; items: OrderItem[]; returnAddress: string }) {
  const names = ret.return_items
    .map((ri) => {
      const item = items.find((i) => i.id === ri.order_item_id)
      return item ? `${item.product_name}${ri.quantity > 1 ? ` ×${ri.quantity}` : ""}` : null
    })
    .filter(Boolean)
    .join(", ")

  return (
    <div className="bg-linen p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          Return {ret.return_number} <span className="font-normal text-muted-foreground">· {dateLong(ret.created_at)}</span>
        </p>
        <ReturnBadge status={ret.status} />
      </div>
      <p className="mt-2 text-muted-foreground">
        {names} — {reasonLabel(ret.reason)}
        {ret.details && <>: “{ret.details}”</>}
      </p>
      {ret.status === "requested" && <p className="mt-2">We'll look at your request and let you know here.</p>}
      {ret.status === "approved" && returnAddress && (
        <div className="mt-3 border-l-2 border-moss pl-3">
          <p className="font-medium">Please send the pieces to:</p>
          <address className="mt-1 whitespace-pre-line not-italic">{returnAddress}</address>
          <p className="mt-1 text-muted-foreground">Write {ret.return_number} on a note inside the parcel.</p>
        </div>
      )}
      {ret.shop_note && (
        <p className="mt-2">
          <span className="font-medium">From Nordaloom:</span> {ret.shop_note}
        </p>
      )}
      {ret.status === "refunded" && ret.refund_cents !== null && (
        <p className="mt-2">
          {ret.refund_cents > 0 ? (
            <>
              {formatPrice(ret.refund_cents)} refunded {ret.refund_method === "card" ? "to your card" : "to the account you paid from"}
            </>
          ) : (
            <>Closed without a refund</>
          )}
          {ret.refunded_at && <> on {dateLong(ret.refunded_at)}</>}.
        </p>
      )}
    </div>
  )
}
