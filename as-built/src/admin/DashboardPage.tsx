import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { ProductImage } from "@/components/art/ProductImage"
import { StatusBadge } from "@/components/Badges"
import { useAuth } from "@/context/AuthContext"
import { useDashboard, dateTime } from "@/lib/admin"
import { formatPrice } from "@/lib/format"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { BarChart } from "./BarChart"
import { useWaiting } from "./AdminLayout"
import { PageHeader, Panel } from "./ui"

const dayLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric" })
const dayLong = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long" })
const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "short" })
const monthLong = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" })

export function DashboardPage() {
  useTitle("Dashboard")
  const { profile } = useAuth()
  const { data: d, isLoading, error } = useDashboard()
  const { data: extra } = useWaiting(true)
  const [dailyMetric, setDailyMetric] = useState<"sales" | "orders">("sales")

  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const firstName = profile?.full_name?.split(" ")[0]

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>
  if (error || !d) return <p className="text-destructive">The dashboard couldn't load. Please refresh the page.</p>

  const avg = d.last30.orders ? Math.round(d.last30.sales_cents / d.last30.orders) : 0
  const prevAvg = d.previous30.orders ? Math.round(d.previous30.sales_cents / d.previous30.orders) : 0
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

  const waiting = [
    { label: "Orders to ship", value: d.waiting.to_ship, to: "/admin/orders?status=paid", note: "Paid, waiting for you" },
    { label: "Awaiting payment", value: d.waiting.awaiting_payment, to: "/admin/orders?status=awaiting_payment", note: "Check the bank" },
    { label: "Returns to decide", value: d.waiting.returns_to_decide, to: "/admin/returns", note: "Approve or refuse" },
    { label: "Returns on their way", value: d.waiting.returns_to_refund, to: "/admin/returns?status=approved", note: "Refund when back" },
    { label: "Parcels in transit", value: d.waiting.in_transit, to: "/admin/orders?status=shipped", note: "Mark delivered" },
    { label: "Messages to answer", value: extra?.messages ?? 0, to: "/admin/messages", note: "From the contact form" },
    { label: "Reviews to read", value: extra?.reviews ?? 0, to: "/admin/reviews", note: "Publish or not" },
  ]

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}
        title={firstName ? `${greeting}, ${firstName}` : greeting}
      />

      {/* What's waiting */}
      <section>
        <h2 className="sr-only">Waiting for you</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {waiting.map((w) => (
            <Link
              key={w.label}
              to={w.to}
              className={cn(
                "group border p-5 transition-colors",
                w.value > 0 ? "border-clay/40 bg-clay/5 hover:bg-clay/10" : "bg-card hover:border-foreground/30",
              )}
            >
              <p className={cn("font-serif text-4xl font-light tabular-nums", w.value > 0 ? "text-clay" : "text-muted-foreground")}>{w.value}</p>
              <p className="mt-2 text-sm font-medium">{w.label}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                {w.note} <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Last 30 days */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl">Last 30 days</h2>
          <p className="text-sm text-muted-foreground">Paid orders · compared with the 30 days before</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-px border bg-border lg:grid-cols-4">
          <Stat label="Sales" value={formatPrice(d.last30.sales_cents)} change={change(d.last30.sales_cents, d.previous30.sales_cents)} />
          <Stat label="Orders" value={String(d.last30.orders)} change={change(d.last30.orders, d.previous30.orders)} />
          <Stat label="Average order" value={formatPrice(avg)} change={change(avg, prevAvg)} />
          <Stat
            label="Refunded"
            value={formatPrice(d.refunded_30d_cents)}
            note={`All time: ${formatPrice(d.all_time.sales_cents)} from ${d.all_time.orders} ${d.all_time.orders === 1 ? "order" : "orders"}`}
          />
        </div>
      </section>

      {/* Charts */}
      <div className="grid gap-6 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title="By day"
          action={
            <div className="flex text-xs">
              {(["sales", "orders"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setDailyMetric(m)}
                  className={cn("-ml-px border px-3 py-2 first:ml-0", dailyMetric === m ? "border-foreground bg-foreground text-background" : "text-muted-foreground")}
                >
                  {m === "sales" ? "Sales" : "Orders"}
                </button>
              ))}
            </div>
          }
        >
          <BarChart
            bars={d.daily.map((x) => ({
              key: x.date,
              label: dayLabel.format(new Date(x.date)),
              tooltip: dayLong.format(new Date(x.date)),
              value: dailyMetric === "sales" ? x.sales_cents : x.orders,
              highlight: x.date === today,
            }))}
            format={dailyMetric === "sales" ? (v) => formatPrice(Math.round(v)) : (v) => String(Math.round(v))}
            labelEvery={3}
          />
        </Panel>
        <Panel className="xl:col-span-2" title="By month">
          <BarChart
            bars={d.monthly.map((x) => ({
              key: x.month,
              label: monthLabel.format(new Date(x.month)),
              tooltip: `${monthLong.format(new Date(x.month))} · ${x.orders} ${x.orders === 1 ? "order" : "orders"}`,
              value: x.sales_cents,
            }))}
            format={(v) => formatPrice(Math.round(v))}
          />
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Best-selling pieces" action={<span className="text-xs text-muted-foreground">Last 90 days</span>}>
          {d.best_sellers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing sold yet — the first paid orders will show up here.</p>
          ) : (
            <ol className="divide-y">
              {d.best_sellers.map((b, i) => (
                <li key={b.product_slug} className="flex items-center gap-4 py-3">
                  <span className="w-5 font-serif text-lg text-clay">{i + 1}</span>
                  <Thumb image={b.product_image} name={b.product_name} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.product_name}</span>
                  <span className="text-right text-sm tabular-nums">
                    {b.pieces} {b.pieces === 1 ? "piece" : "pieces"}
                    <span className="block text-xs text-muted-foreground">{formatPrice(b.sales_cents)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel
          title="Running low"
          action={
            <Link to="/admin/stock?filter=low" className="text-sm underline underline-offset-4">
              {d.low_stock_count > d.low_stock.length ? `All ${d.low_stock_count}` : "Stock"}
            </Link>
          }
        >
          {d.low_stock.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everything has more than {d.low_stock_threshold} pieces in stock.</p>
          ) : (
            <ul className="divide-y">
              {d.low_stock.map((l) => (
                <li key={l.variant_id} className="flex items-center gap-4 py-3">
                  <Thumb image={l.product_image} name={l.product_name} />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-medium">{l.product_name}</span>
                    <span className="text-muted-foreground">
                      {l.colour}
                      {l.size !== "One size" && <> · {l.size}</>}
                    </span>
                  </span>
                  <span className={cn("text-sm font-medium tabular-nums", l.stock === 0 ? "text-destructive" : "text-clay")}>
                    {l.stock === 0 ? "Sold out" : `${l.stock} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Latest orders" action={<Link to="/admin/orders" className="text-sm underline underline-offset-4">All orders</Link>}>
        {d.recent_orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="divide-y">
            {d.recent_orders.map((o) => (
              <li key={o.order_number}>
                <Link to={`/admin/orders/${o.order_number}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 py-3 text-sm hover:bg-sand/40">
                  <span className="w-28 font-medium">{o.order_number}</span>
                  <span className="min-w-0 flex-1 truncate">{o.full_name}</span>
                  <span className="text-muted-foreground">{dateTime.format(new Date(o.created_at))}</span>
                  <span className="w-20 text-right tabular-nums">{formatPrice(o.total_cents)}</span>
                  <StatusBadge status={o.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function change(now: number, before: number) {
  if (before === 0) return null
  return Math.round(((now - before) / before) * 100)
}

function Stat({ label, value, change, note }: { label: string; value: string; change?: number | null; note?: string }) {
  return (
    <div className="bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-serif text-3xl font-light tabular-nums">{value}</p>
      {change !== undefined && (
        <p className={cn("mt-1 text-xs", change === null ? "text-muted-foreground" : change >= 0 ? "text-moss" : "text-clay")}>
          {change === null ? "No earlier figures to compare" : `${change >= 0 ? "+" : ""}${change}% on the previous 30 days`}
        </p>
      )}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

function Thumb({ image, name }: { image: string | null; name: string }) {
  return (
    <span className="block aspect-[4/5] w-10 shrink-0 overflow-hidden bg-muted">
      <ProductImage product={{ slug: name, category_slug: "", name, images: image ? [image] : [], colours: [] }} />
    </span>
  )
}
