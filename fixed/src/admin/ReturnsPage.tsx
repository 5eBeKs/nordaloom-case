import { useEffect, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ReturnBadge } from "@/components/Badges"
import { supabase } from "@/lib/supabase"
import { formatPrice } from "@/lib/format"
import type { OrderItem } from "@/lib/checkout"
import { useShopSettings } from "@/lib/checkout"
import { cardLabel, refundReturnToCard } from "@/lib/payments"
import { reasonLabel, type ReturnRequest, type ReturnStatus } from "@/lib/account"
import { dateShort } from "@/lib/admin"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, FilterTabs, PageHeader } from "./ui"

type AdminReturn = Omit<ReturnRequest, "return_items"> & {
  return_items: { quantity: number; order_items: OrderItem }[]
  orders: {
    order_number: string
    full_name: string
    email: string
    phone: string
    delivered_at: string | null
    subtotal_cents: number
    discount_cents: number
    discount_code: string | null
    shipping_cents: number
    total_cents: number
    refunded_cents: number
    payment_method: "bank_transfer" | "card"
    card_brand: string | null
    card_last4: string | null
    order_items: { quantity: number }[]
    returns: { id: string; status: ReturnStatus; return_items: { quantity: number }[] }[]
  }
}

type Filter = ReturnStatus | "all"
const FILTERS: { key: Filter; label: string }[] = [
  { key: "requested", label: "To decide" },
  { key: "approved", label: "On their way back" },
  { key: "refunded", label: "Refunded" },
  { key: "refused", label: "Refused" },
  { key: "all", label: "All" },
]

export function ReturnsPage() {
  useTitle("Returns")
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS.some((f) => f.key === params.get("status")) ? params.get("status") : "requested") as Filter
  const { data: settings } = useShopSettings()

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ["admin-returns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("returns")
        .select("*, return_items(quantity, order_items(*)), orders(order_number, full_name, email, phone, delivered_at, subtotal_cents, discount_cents, discount_code, shipping_cents, total_cents, refunded_cents, payment_method, card_brand, card_last4, order_items(quantity), returns(id, status, return_items(quantity)))")
        .order("created_at", { ascending: false })
      if (error) throw error
      return data as AdminReturn[]
    },
  })

  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, f.key === "all" ? returns.length : returns.filter((r) => r.status === f.key).length]))
  const shown = filter === "all" ? returns : returns.filter((r) => r.status === filter)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Returns"
        intro={
          <>
            Approve or refuse each request. Approved customers see your return address
            {settings?.return_address && <> ({settings.return_address.split("\n").slice(1, 3).join(", ")})</>} and any note you add. When the
            pieces are back, refund them: card payments go straight back to the card from here; for bank transfers, send the money from your bank and mark the return as refunded.
          </>
        }
      />
      <div>
        <FilterTabs options={FILTERS} value={filter} onChange={(v) => setParams(v === "requested" ? {} : { status: v })} counts={counts} />
        {isLoading ? (
          <Empty>Loading returns…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{filter === "requested" ? "No return requests waiting for you." : "No returns here."}</Empty>
        ) : (
          <ul className="divide-y border-b">
            {shown.map((r) => (
              <ReturnRow key={r.id} ret={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ReturnRow({ ret }: { ret: AdminReturn }) {
  const [open, setOpen] = useState(ret.status === "requested" || ret.status === "approved")
  const [note, setNote] = useState("")
  const itemsValue = ret.return_items.reduce((s, ri) => s + ri.order_items.unit_price_cents * ri.quantity, 0)
  // With a discount code the customer paid less for each piece: suggest their share of it back.
  const discountShare = ret.orders.discount_cents > 0 && ret.orders.subtotal_cents > 0
    ? Math.round((itemsValue * ret.orders.discount_cents) / ret.orders.subtotal_cents)
    : 0
  const paidForPieces = itemsValue - discountShare
  // EU rule: when the whole order comes back, the (standard) delivery cost is refunded too.
  // It goes with the return that brings the last pieces home: every other piece of the order
  // must already be refunded, so delivery is never offered twice, or while part is still undecided.
  const pieces = ret.return_items.reduce((n, ri) => n + ri.quantity, 0)
  const orderPieces = ret.orders.order_items.reduce((n, i) => n + i.quantity, 0)
  const refundedElsewhere = ret.orders.returns
    .filter((r) => r.id !== ret.id && r.status === "refunded")
    .reduce((n, r) => n + r.return_items.reduce((m, ri) => m + ri.quantity, 0), 0)
  const wholeOrder = orderPieces > 0 && refundedElsewhere + pieces >= orderPieces
  const card = ret.orders.payment_method === "card"
  // Never more than is left of what the customer paid.
  const leftToRefund = Math.max(0, ret.orders.total_cents - ret.orders.refunded_cents)
  const deliveryBack = wholeOrder ? Math.min(ret.orders.shipping_cents, Math.max(0, leftToRefund - paidForPieces)) : 0
  const suggestion = Math.min(paidForPieces + deliveryBack, leftToRefund)
  const [amount, setAmount] = useState((suggestion / 100).toFixed(2))
  // The suggestion follows the order (another return refunded meanwhile) until the owner types an amount.
  const typed = useRef(false)
  useEffect(() => {
    if (!typed.current) setAmount((suggestion / 100).toFixed(2))
  }, [suggestion])
  const [restock, setRestock] = useState(true)
  const queryClient = useQueryClient()

  const update = useMutation({
    mutationFn: async (args: { action: "approve" | "refuse" | "refund"; note?: string; refund?: number; restock?: boolean }) => {
      if (args.action === "refund" && card) {
        const r = await refundReturnToCard(ret.id, args.refund!, !!args.restock)
        if (!r.ok) throw new Error(r.code)
        return args.action
      }
      const { error } = await supabase.rpc("update_return", {
        p_return_id: ret.id,
        p_action: args.action,
        p_note: args.note ?? "",
        p_refund_cents: args.refund ?? null,
        p_restock: args.restock ?? false,
      })
      if (error) throw error
      return args.action
    },
    onSuccess: (action, vars) => {
      toast.success(
        `${ret.return_number} ${action === "approve" ? "approved" : action === "refuse" ? "refused" : vars.refund === 0 ? "closed without a refund" : card ? "refunded to the card" : "marked as refunded"}.`,
      )
      for (const key of ["admin-returns", "admin-waiting", "admin-dashboard", "admin-products", "products", "admin-emails"]) void queryClient.invalidateQueries({ queryKey: [key] })
    },
    onError: (e) =>
      toast.error(
        e.message === "more_than_paid" || e.message === "refund_too_large"
          ? `That's more than is left to refund on this order (${formatPrice(leftToRefund)}).`
          : card && e.message.startsWith("Stripe")
            ? `Stripe didn't accept the refund: ${e.message.replace(/^Stripe:\s*/, "")}`
            : "That didn't work — please refresh and try again.",
      ),
  })

  function refuse() {
    if (!note.trim()) {
      toast("Please add a note telling the customer why.")
      return
    }
    update.mutate({ action: "refuse", note: note.trim() })
  }

  function refund() {
    // A plain amount only: "29.99" or "29,99". "1.234,56" would otherwise be read as 1.23.
    const typedAmount = amount.trim()
    if (!/^\d+([.,]\d{1,2})?$/.test(typedAmount)) {
      toast("Please type the amount as a plain number, like 29.99.")
      return
    }
    const cents = Math.round(parseFloat(typedAmount.replace(",", ".")) * 100)
    if (!Number.isFinite(cents) || cents < 0) {
      toast(card ? "Please enter the amount to refund." : "Please enter the amount you refunded.")
      return
    }
    if (cents > leftToRefund) {
      toast(`That's more than is left to refund on this order (${formatPrice(leftToRefund)}).`)
      return
    }
    if (cents === 0 && !window.confirm(`Close ${ret.return_number} without a refund? The customer is told so.`)) return
    if (card && cents > 0 && !window.confirm(`Refund ${formatPrice(cents)} to the customer's card now?`)) return
    update.mutate({ action: "refund", refund: cents, restock })
  }

  return (
    <li>
      <button onClick={() => setOpen((v) => !v)} className="grid w-full grid-cols-12 items-center gap-3 px-2 py-4 text-left text-sm hover:bg-sand/50" aria-expanded={open}>
        <span className="col-span-6 sm:col-span-2">
          <span className="block font-medium">{ret.return_number}</span>
          <span className="text-xs text-muted-foreground">{dateShort.format(new Date(ret.created_at))}</span>
        </span>
        <span className="col-span-6 truncate sm:col-span-4">
          <span className="block truncate">{ret.orders.full_name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {ret.orders.order_number} · {reasonLabel(ret.reason)}
          </span>
        </span>
        <span className="col-span-4 text-muted-foreground sm:col-span-2">
          {pieces} {pieces === 1 ? "piece" : "pieces"}
        </span>
        <span className="col-span-4 tabular-nums sm:col-span-2">{formatPrice(itemsValue)}</span>
        <span className="col-span-4 flex items-center justify-end gap-3 sm:col-span-2">
          <ReturnBadge status={ret.status} />
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="grid gap-8 px-2 pb-8 md:grid-cols-3">
          <div className="md:col-span-2">
            <ul className="divide-y border-y text-sm">
              {ret.return_items.map((ri) => (
                <li key={ri.order_items.id} className="flex justify-between gap-4 py-3">
                  <span>
                    <span className="font-medium">{ri.order_items.product_name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {ri.order_items.colour}
                      {ri.order_items.size !== "One size" && <> · {ri.order_items.size}</>} · ×{ri.quantity}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatPrice(ri.order_items.unit_price_cents * ri.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 text-sm">
              <p className="eyebrow">Customer's reason</p>
              <p className="mt-2">
                {reasonLabel(ret.reason)}
                {ret.details && <span className="text-muted-foreground"> — “{ret.details}”</span>}
              </p>
            </div>
            {ret.shop_note && (
              <div className="mt-5 text-sm">
                <p className="eyebrow">Your note to the customer</p>
                <p className="mt-2">{ret.shop_note}</p>
              </div>
            )}
          </div>

          <div className="space-y-5 text-sm">
            <div>
              <p className="eyebrow">Order</p>
              <p className="mt-2 leading-relaxed">
                <Link to={`/admin/orders/${ret.orders.order_number}`} className="underline underline-offset-4">
                  {ret.orders.order_number}
                </Link>
                {ret.orders.delivered_at && <> · delivered {dateShort.format(new Date(ret.orders.delivered_at))}</>}
                <br />
                {ret.orders.email} · {ret.orders.phone}
              </p>
            </div>

            {ret.status === "requested" && (
              <div className="space-y-3">
                <label htmlFor={`note-${ret.id}`} className="eyebrow block">
                  Note to the customer
                </label>
                <textarea
                  id={`note-${ret.id}`}
                  rows={3}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional when approving. Needed when refusing: tell them why."
                  className="w-full border border-input bg-card p-3 text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="rounded-none" disabled={update.isPending} onClick={() => update.mutate({ action: "approve", note: note.trim() })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-none bg-transparent" disabled={update.isPending} onClick={refuse}>
                    Refuse
                  </Button>
                </div>
              </div>
            )}

            {ret.status === "approved" && (
              <div className="space-y-3">
                <label htmlFor={`amount-${ret.id}`} className="eyebrow block">
                  {card ? "Amount to refund to the card (€)" : "Amount refunded (€)"}
                </label>
                {card && (
                  <p className="text-xs text-muted-foreground">
                    Paid with {cardLabel(ret.orders.card_brand, ret.orders.card_last4)}. The money goes straight back to it through Stripe.
                  </p>
                )}
                <Input
                  id={`amount-${ret.id}`}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    typed.current = true
                    setAmount(e.target.value)
                  }}
                  className="h-10 w-40 rounded-none bg-card"
                />
                <p className="text-xs text-muted-foreground">
                  The customer paid {formatPrice(ret.orders.total_cents)} for the order
                  {ret.orders.refunded_cents > 0 && <>, and {formatPrice(ret.orders.refunded_cents)} of it has been refunded already</>}.
                </p>
                {discountShare > 0 && (
                  <p className="text-xs text-muted-foreground">
                    The order used {ret.orders.discount_code}, so the customer paid {formatPrice(paidForPieces)} for these pieces
                    ({formatPrice(itemsValue)} minus {formatPrice(discountShare)} of the discount).
                  </p>
                )}
                {deliveryBack > 0 && (
                  <p className="text-xs text-muted-foreground">
                    With this return the whole order is coming back, so the suggestion includes the {formatPrice(deliveryBack)} paid for delivery.
                  </p>
                )}
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="accent-foreground" />
                  Put the {pieces === 1 ? "piece" : "pieces"} back in stock
                </label>
                <Button size="sm" className="rounded-none" disabled={update.isPending} onClick={refund}>
                  {update.isPending && card ? "Refunding…" : card ? `Refund to card` : "Mark as refunded"}
                </Button>
              </div>
            )}

            {ret.status === "refunded" && (
              <p>
                {formatPrice(ret.refund_cents ?? 0)} refunded{card && " to the card"}
                {ret.refunded_at && <> on {dateShort.format(new Date(ret.refunded_at))}</>}
                {ret.restocked ? " · back in stock" : " · not restocked"}
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
