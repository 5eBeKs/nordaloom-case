import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { StatusBadge } from "@/components/Badges"
import { ORDERS_PAGE_SIZE, dateTime, useAdminOrders, useOrderCounts } from "@/lib/admin"
import type { OrderStatus } from "@/lib/checkout"
import { formatPrice } from "@/lib/format"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, FilterTabs, PageHeader, SearchInput } from "./ui"

type Filter = OrderStatus | "all"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "awaiting_payment", label: "Awaiting payment" },
  { key: "paid", label: "To ship" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
]

export function OrdersPage() {
  useTitle("Orders")
  const [params, setParams] = useSearchParams()
  const status = (FILTERS.some((f) => f.key === params.get("status")) ? params.get("status") : "all") as Filter
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0)
  const [search, setSearch] = useState(params.get("q") ?? "")
  const [debounced, setDebounced] = useState(search)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  // Keep the URL in step so the back button returns to the same view.
  useEffect(() => {
    const next = new URLSearchParams(params)
    if (debounced) next.set("q", debounced)
    else next.delete("q")
    if (debounced !== (params.get("q") ?? "")) next.delete("page")
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [debounced, params, setParams])

  const { data, isLoading, isFetching } = useAdminOrders(debounced, status, page)
  const { data: counts } = useOrderCounts()
  const pages = data ? Math.max(1, Math.ceil(data.total / ORDERS_PAGE_SIZE)) : 1

  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Orders"
        intro="Find an order by its number, the customer's name or email. Open it to mark it paid, shipped or delivered."
      />

      <SearchInput value={search} onChange={setSearch} placeholder="Search NRD-10001, a name or an email" className="max-w-xl" />

      <div>
        <FilterTabs options={FILTERS} value={status} onChange={(v) => go({ status: v === "all" ? null : v, page: null })} counts={counts} />

        {isLoading ? (
          <Empty>Loading orders…</Empty>
        ) : !data || data.orders.length === 0 ? (
          <Empty>{debounced ? `No orders match “${debounced}”.` : "No orders here yet."}</Empty>
        ) : (
          <ul className={cn("divide-y border-b transition-opacity", isFetching && "opacity-60")}>
            {data.orders.map((o) => {
              const pieces = o.order_items.reduce((n, i) => n + i.quantity, 0)
              const overdue = o.status === "awaiting_payment" && o.payment_due_at && new Date(o.payment_due_at) < new Date()
              return (
                <li key={o.id}>
                  <Link to={`/admin/orders/${o.order_number}`} className="grid grid-cols-12 items-center gap-3 px-2 py-4 text-sm transition-colors hover:bg-sand/50">
                    <span className="col-span-6 sm:col-span-2">
                      <span className="block font-medium">{o.order_number}</span>
                      <span className="text-xs text-muted-foreground">{dateTime.format(new Date(o.created_at))}</span>
                    </span>
                    <span className="col-span-6 min-w-0 sm:col-span-4">
                      <span className="block truncate">{o.full_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{o.email}</span>
                    </span>
                    <span className="col-span-6 text-muted-foreground sm:col-span-2">
                      {pieces} {pieces === 1 ? "piece" : "pieces"}
                      <span className="block text-xs">{o.shipping_label}</span>
                    </span>
                    <span className="col-span-6 text-right tabular-nums sm:col-span-2 sm:text-left">{formatPrice(o.total_cents)}</span>
                    <span className="col-span-12 sm:col-span-2 sm:text-right">
                      <StatusBadge status={o.status} />
                      {overdue && <span className="mt-1 block text-xs text-destructive">Past due date</span>}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        {data && data.total > ORDERS_PAGE_SIZE && (
          <div className="mt-6 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {page * ORDERS_PAGE_SIZE + 1}–{Math.min((page + 1) * ORDERS_PAGE_SIZE, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => go({ page: page - 1 ? String(page - 1) : null })} className="flex items-center gap-1 border px-3 py-1.5 disabled:opacity-40">
                <ChevronLeft className="size-4" /> Newer
              </button>
              <button disabled={page + 1 >= pages} onClick={() => go({ page: String(page + 1) })} className="flex items-center gap-1 border px-3 py-1.5 disabled:opacity-40">
                Older <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
