import { useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowDown, ArrowUp, Download, FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPrice } from "@/lib/format"
import { countryName } from "@/lib/checkout"
import { reasonLabel, type ReturnReason } from "@/lib/account"
import { downloadWorkbook, type CellKind, type Sheet } from "@/lib/xlsx"
import {
  addDays,
  change,
  daysBetween,
  defaultGroup,
  formatBucket,
  formatDay,
  formatRange,
  PRESETS,
  share,
  todayRiga,
  useReport,
  type Group,
  type Report,
} from "@/lib/reports"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, PageHeader } from "./ui"

// ---------------------------------------------------------------------------
// Tables that know how to show themselves and how to become a spreadsheet
// ---------------------------------------------------------------------------

type Col<T> = {
  header: string
  kind: CellKind
  value: (row: T) => string | number | null | undefined
  /** How it looks on the page, if not just the formatted value. */
  render?: (row: T) => ReactNode
  hideOnSmall?: boolean
}

const pct = (f: number) => `${(f * 100).toLocaleString("en-GB", { maximumFractionDigits: f < 0.1 && f > 0 ? 1 : 0 })}%`

function show(kind: CellKind, v: unknown): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>
  if (kind === "money") return formatPrice(Number(v))
  if (kind === "percent") return pct(Number(v))
  if (kind === "date") return formatDay(String(v), true)
  if (kind === "number") return Number(v).toLocaleString("en-GB")
  return String(v)
}

type TableSpec<T> = { name: string; columns: Col<T>[]; rows: T[] }
const asSheet = <T,>(t: TableSpec<T>): Sheet<T> => ({ name: t.name, rows: t.rows, columns: t.columns.map(({ header, kind, value }) => ({ header, kind, value })) })

function ReportTable<T>({ spec, filename, limit, empty = "Nothing in this period." }: { spec: TableSpec<T>; filename: string; limit?: number; empty?: string }) {
  const [all, setAll] = useState(false)
  const rows = limit && !all ? spec.rows.slice(0, limit) : spec.rows
  return (
    <div>
      <div className="mb-3 flex items-center justify-end">
        <DownloadButton onClick={() => downloadWorkbook(filename, [asSheet(spec)])} disabled={spec.rows.length === 0} />
      </div>
      {spec.rows.length === 0 ? (
        <p className="border-y py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-foreground/30 text-left">
                {spec.columns.map((c, i) => (
                  <th key={c.header} scope="col" className={cn("py-2.5 pr-4 font-medium whitespace-nowrap", i > 0 && c.kind !== "text" && "text-right", c.hideOnSmall && "hidden md:table-cell")}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b">
                  {spec.columns.map((c, i) => (
                    <td
                      key={c.header}
                      className={cn("py-2.5 pr-4 align-top", i > 0 && c.kind !== "text" && "text-right tabular-nums whitespace-nowrap", c.hideOnSmall && "hidden md:table-cell")}
                    >
                      {c.render ? c.render(r) : show(c.kind, c.value(r))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {limit && spec.rows.length > limit && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 text-sm underline underline-offset-4">
          {all ? "Show fewer" : `Show all ${spec.rows.length}`}
        </button>
      )}
    </div>
  )
}

function DownloadButton({ onClick, disabled, label = "Spreadsheet" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
      title="Download as an Excel file (.xlsx)"
    >
      <FileSpreadsheet className="size-3.5" strokeWidth={1.5} /> {label}
    </button>
  )
}

/** A thin bar showing a share, behind a figure. */
function ShareBar({ value, children }: { value: number; children: ReactNode }) {
  return (
    <span className="relative flex min-w-40 items-center gap-3">
      <span className="h-1.5 flex-1 bg-sand">
        <span className="block h-full bg-foreground/70" style={{ width: `${Math.min(100, value * 100)}%` }} />
      </span>
      <span className="w-12 text-right tabular-nums">{children}</span>
    </span>
  )
}

function Change({ now, before, goodWhenUp = true }: { now: number; before: number; goodWhenUp?: boolean }) {
  const c = change(now, before)
  if (c === null) return <span className="text-xs text-muted-foreground">new</span>
  if (Math.abs(c) < 0.005) return <span className="text-xs text-muted-foreground">no change</span>
  const up = c > 0
  const good = up === goodWhenUp
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs tabular-nums", good ? "text-moss" : "text-clay")}>
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {pct(Math.abs(c))}
    </span>
  )
}

function Section({ id, title, intro, children, action }: { id: string; title: string; intro?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl">{title}</h2>
          {intro && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{intro}</p>}
        </div>
        {action}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  )
}

function Figure({ label, value, note, children }: { label: string; value: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 font-serif text-3xl font-light tabular-nums">{value}</p>
      <div className="mt-1 min-h-4 text-xs text-muted-foreground">{note}</div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The sales chart: this period's bars, the period before as outlines
// ---------------------------------------------------------------------------

/** The bar under the finger or pointer. */
function pickBar(e: React.PointerEvent<HTMLDivElement>, count: number) {
  const r = e.currentTarget.getBoundingClientRect()
  return Math.max(0, Math.min(count - 1, Math.floor(((e.clientX - r.left) / r.width) * count)))
}

function SalesChart({ report, metric }: { report: Report; metric: "revenue" | "orders" }) {
  const [active, setActive] = useState<number | null>(null)
  const pts = report.series.map((b) => ({
    label: formatBucket(b.start, report.period.group),
    now: metric === "revenue" ? b.revenue_cents : b.orders,
    before: metric === "revenue" ? b.previous_revenue_cents : b.previous_orders,
  }))
  const max = Math.max(1, ...pts.flatMap((p) => [p.now, p.before]))
  const fmt = (v: number) => (metric === "revenue" ? formatPrice(v) : `${v} ${v === 1 ? "order" : "orders"}`)
  const shown = active !== null ? pts[active] : null
  const every = Math.ceil(pts.length / 12)
  return (
    <div>
      <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
        {shown ? (
          <>
            <span className="text-foreground">{shown.label}</span> · {fmt(shown.now)} <span className="mx-1">·</span> period before: {fmt(shown.before)}
          </>
        ) : (
          "Point at or touch a bar to see its figures."
        )}
      </p>
      <div
        className="relative mt-6 h-56 touch-pan-y"
        onPointerMove={(e) => setActive(pickBar(e, pts.length))}
        onPointerDown={(e) => setActive(pickBar(e, pts.length))}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
      >
        {[0.5, 1].map((g) => (
          <div key={g} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${g * 100}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px] border-b border-foreground/30">
          {pts.map((p, i) => (
            <div key={i} className="relative flex h-full flex-1 items-end justify-center outline-none focus-visible:bg-sand/60" onFocus={() => setActive(i)} tabIndex={0} aria-label={`${p.label}: ${fmt(p.now)}; period before ${fmt(p.before)}`}>
              <div className="absolute bottom-0 w-[70%] border border-foreground/35" style={{ height: `${(p.before / max) * 100}%` }} />
              <div className={cn("relative w-[46%] transition-colors", active === i ? "bg-clay" : "bg-foreground/85")} style={{ height: `${(p.now / max) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-[2px] text-[0.7rem] text-muted-foreground">
        {pts.map((p, i) => (
          <span key={i} className="flex-1 truncate text-center">
            {i % every === 0 ? p.label.replace("Week of ", "") : ""}
          </span>
        ))}
      </div>
      <p className="mt-4 flex gap-5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 bg-foreground/85" /> {formatRange(report.period.from, report.period.to)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 border border-foreground/40" /> {formatRange(report.period.previous_from, report.period.previous_to)}
        </span>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const NAV = [
  ["sales", "Sales"],
  ["categories", "Categories"],
  ["pieces", "Pieces"],
  ["sizes", "Sizes & colours"],
  ["customers", "Customers"],
  ["returns", "Returns"],
  ["codes", "Discount codes"],
  ["unpaid", "Unpaid orders"],
  ["countries", "Countries"],
] as const

export function ReportsPage() {
  useTitle("Reports")
  const [params, setParams] = useSearchParams()
  const presetKey = params.get("period") ?? (params.get("from") ? "custom" : "30d")
  const preset = PRESETS.find((p) => p.key === presetKey)
  const [from, to] = preset ? preset.range() : [params.get("from") ?? addDays(todayRiga(), -29), params.get("to") ?? todayRiga()]
  const days = daysBetween(from, to)
  const group = (["day", "week", "month"].includes(params.get("group") ?? "") ? params.get("group") : defaultGroup(days)) as Group
  const [metric, setMetric] = useState<"revenue" | "orders">("revenue")
  const valid = from <= to && days <= 3650
  const { data: r, isLoading, isFetching, error } = useReport(from, valid ? to : from, group)

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) v === null ? p.delete(k) : p.set(k, v)
    setParams(p, { replace: true })
  }
  const choosePreset = (key: string) => update({ period: key, from: null, to: null, group: null })
  const chooseDates = (f: string, t: string) => update({ period: null, from: f, to: t, group: null })

  const tables = useMemo(() => (r ? buildTables(r) : null), [r])
  const fileBase = `nordaloom-${from}-to-${to}`

  return (
    <div className="space-y-10">
      <PageHeader
        title="Reports"
        intro="Figures for the period you choose, compared with the period of the same length just before it. Every table downloads as an Excel file."
        actions={
          tables && (
            <Button variant="outline" className="h-11 rounded-none bg-transparent" onClick={() => downloadWorkbook(`${fileBase}-all`, tables.all)}>
              <Download className="size-4" /> Download everything
            </Button>
          )
        }
      />

      {/* Period */}
      <div className="space-y-4 border bg-card p-5">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => choosePreset(p.key)}
              className={cn("border px-3 py-2.5 text-sm", presetKey === p.key ? "border-foreground bg-foreground text-background" : "border-input hover:border-foreground")}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">From</span>
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && chooseDates(e.target.value, to)} className="mt-1 h-10 border border-input bg-background px-2" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">To</span>
            <input type="date" value={to} min={from} max={todayRiga()} onChange={(e) => e.target.value && chooseDates(from, e.target.value)} className="mt-1 h-10 border border-input bg-background px-2" />
          </label>
          <div className="text-sm">
            <span className="block text-xs text-muted-foreground">Show by</span>
            <div className="mt-1 flex" role="radiogroup" aria-label="Show by">
              {(["day", "week", "month"] as Group[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={group === g}
                  onClick={() => update({ group: g })}
                  className={cn("h-10 border px-4 capitalize -ml-px first:ml-0", group === g ? "relative border-foreground bg-foreground text-background" : "border-input hover:border-foreground")}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {days} {days === 1 ? "day" : "days"} · compared with {r ? formatRange(r.period.previous_from, r.period.previous_to) : "the period before"}
            {isFetching && !isLoading && " · updating…"}
          </p>
        </div>
        {!valid && <p className="text-sm text-destructive">Please choose a start date before the end date (and at most ten years).</p>}
      </div>

      <nav aria-label="Report sections" className="-mx-5 flex gap-1 overflow-x-auto border-b bg-background/95 px-5 py-2 backdrop-blur md:-mx-10 md:px-10 lg:sticky lg:top-16 lg:z-10">
        {NAV.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground">
            {label}
          </a>
        ))}
      </nav>

      {error ? (
        <Empty>The report couldn't be loaded. Please refresh the page.</Empty>
      ) : isLoading || !r || !tables ? (
        <Empty>Working out the figures…</Empty>
      ) : (
        <div className={cn("space-y-14 transition-opacity", isFetching && "opacity-60")}>
          <Sales r={r} metric={metric} setMetric={setMetric} tables={tables} fileBase={fileBase} />
          <Section id="categories" title="Categories" intro="What each category sold, before discounts and delivery. The change is against the period before.">
            <ReportTable spec={tables.categories} filename={`${fileBase}-categories`} />
          </Section>
          <Section id="pieces" title="Pieces" intro="Every piece that sold, best first. Returned pieces are those sent back from orders in this period.">
            <ReportTable spec={tables.products} filename={`${fileBase}-pieces`} limit={12} />
          </Section>
          <Section id="sizes" title="Sizes and colours" intro="What sells, against what's on the shelf now. Sell-through is the share of (sold + in stock) that sold.">
            <div className="grid gap-10 xl:grid-cols-2">
              <div>
                <h3 className="mb-1 text-lg">Sizes</h3>
                <ReportTable spec={tables.sizes} filename={`${fileBase}-sizes`} />
              </div>
              <div>
                <h3 className="mb-1 text-lg">Colours</h3>
                <ReportTable spec={tables.colours} filename={`${fileBase}-colours`} limit={12} />
              </div>
            </div>
            <div className="mt-10">
              <h3 className="text-lg">Sitting on the shelf</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                In stock and in the shop, but not one sold in this period — {r.sitting.length} {r.sitting.length === 1 ? "variant" : "variants"}, most stock first.
              </p>
              <ReportTable spec={tables.sitting} filename={`${fileBase}-not-selling`} limit={10} empty="Everything in stock sold at least once in this period." />
            </div>
          </Section>
          <Customers r={r} tables={tables} fileBase={fileBase} />
          <Returns r={r} tables={tables} fileBase={fileBase} />
          <Section id="codes" title="Discount codes" intro="Paid orders with each code, and without one. “First orders” are orders that were the customer's very first.">
            <DiscountSummary r={r} />
            <ReportTable spec={tables.discounts} filename={`${fileBase}-discount-codes`} empty="No paid orders in this period." />
          </Section>
          <Unpaid r={r} tables={tables} fileBase={fileBase} />
          <Section id="countries" title="Where we ship" intro="Paid orders by delivery country.">
            <ReportTable spec={tables.countries} filename={`${fileBase}-countries`} />
          </Section>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sections with figures of their own
// ---------------------------------------------------------------------------

type Tables = ReturnType<typeof buildTables>

function Sales({ r, metric, setMetric, tables, fileBase }: { r: Report; metric: "revenue" | "orders"; setMetric: (m: "revenue" | "orders") => void; tables: Tables; fileBase: string }) {
  const c = r.summary.current
  const p = r.summary.previous
  const aov = c.orders ? Math.round(c.revenue_cents / c.orders) : 0
  const prevAov = p.orders ? Math.round(p.revenue_cents / p.orders) : 0
  return (
    <Section id="sales" title="Sales" intro="Paid orders placed in the period (VAT and delivery included). Refunds are counted on the day they were made.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Sales" value={formatPrice(c.revenue_cents)} note={<><Change now={c.revenue_cents} before={p.revenue_cents} /> · before {formatPrice(p.revenue_cents)}</>} />
        <Figure label="Orders" value={c.orders} note={<><Change now={c.orders} before={p.orders} /> · before {p.orders}</>} />
        <Figure label="Average order" value={formatPrice(aov)} note={<><Change now={aov} before={prevAov} /> · before {formatPrice(prevAov)}</>} />
        <Figure label="Pieces sold" value={c.pieces} note={<><Change now={c.pieces} before={p.pieces} /> · before {p.pieces}</>} />
        <Figure label="After refunds" value={formatPrice(c.revenue_cents - c.refunded_cents)} note={<>refunded {formatPrice(c.refunded_cents)}</>} />
        <Figure label="Customers" value={c.customers} note={<><Change now={c.customers} before={p.customers} /> · before {p.customers}</>} />
        <Figure label="Given in discounts" value={formatPrice(c.discount_cents)} note={<><Change now={c.discount_cents} before={p.discount_cents} goodWhenUp={false} /> · before {formatPrice(p.discount_cents)}</>} />
        <Figure label="VAT included" value={formatPrice(c.vat_cents)} note={<>delivery charged {formatPrice(c.shipping_cents)}</>} />
      </div>
      <div className="mt-10 border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex" role="radiogroup" aria-label="Chart shows">
            {(["revenue", "orders"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={metric === m} onClick={() => setMetric(m)} className={cn("-ml-px border px-3 py-1.5 text-sm first:ml-0", metric === m ? "relative border-foreground bg-foreground text-background" : "border-input")}>
                {m === "revenue" ? "Sales" : "Orders"}
              </button>
            ))}
          </div>
          <DownloadButton onClick={() => downloadWorkbook(`${fileBase}-sales-by-${r.period.group}`, [asSheet(tables.series)])} />
        </div>
        <div className="mt-4">
          <SalesChart report={r} metric={metric} />
        </div>
      </div>
    </Section>
  )
}

function Customers({ r, tables, fileBase }: { r: Report; tables: Tables; fileBase: string }) {
  const c = r.customers
  const total = c.new + c.returning
  return (
    <Section
      id="customers"
      title="Customers"
      intro="A customer is an email address. New means their first paid order ever was in this period; returning means they'd ordered before."
      action={<DownloadButton onClick={() => downloadWorkbook(`${fileBase}-customers`, [asSheet(tables.customers)])} />}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="New customers" value={c.new} note={`${pct(share(c.new, total))} of customers · ${formatPrice(c.new_revenue_cents)}`} />
        <Figure label="Returning customers" value={c.returning} note={`${pct(share(c.returning, total))} of customers · ${formatPrice(c.returning_revenue_cents)}`} />
        <Figure
          label="New ones who came back"
          value={c.first_timers ? pct(share(c.first_timers_came_back, c.first_timers)) : "—"}
          note={`${c.first_timers_came_back} of ${c.first_timers} have ordered again since`}
        />
        <Figure
          label="Customers with a second order"
          value={c.all_customers ? pct(share(c.all_repeat_customers, c.all_customers)) : "—"}
          note={
            <>
              {c.all_repeat_customers} of {c.all_customers}, all time
              {c.median_days_to_second_order !== null && <> · usually {Math.round(c.median_days_to_second_order)} days apart</>}
            </>
          }
        />
      </div>
    </Section>
  )
}

function Returns({ r, tables, fileBase }: { r: Report; tables: Tables; fileBase: string }) {
  const x = r.returns
  return (
    <Section id="returns" title="Returns" intro="Returns asked for on the paid orders of this period (refused ones count in the reasons, not in the shares).">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Orders with a return" value={pct(share(x.orders_with_returns, x.orders))} note={`${x.orders_with_returns} of ${x.orders} orders`} />
        <Figure label="Pieces returned" value={pct(share(x.pieces_returned, x.pieces_sold))} note={`${x.pieces_returned} of ${x.pieces_sold} pieces`} />
        <Figure label="Refunded in the period" value={formatPrice(x.refunded_cents)} note="by the day of the refund" />
        <Figure label="Most common reason" value={x.reasons[0] ? reasonLabel(x.reasons[0].reason as ReturnReason) : "—"} note={x.reasons[0] ? `${x.reasons[0].returns} of ${x.reasons.reduce((s, a) => s + a.returns, 0)} returns` : undefined} />
      </div>
      <div className="mt-8">
        <h3 className="mb-1 text-lg">Reasons</h3>
        <ReportTable spec={tables.reasons} filename={`${fileBase}-return-reasons`} empty="No returns for this period's orders." />
      </div>
    </Section>
  )
}

function DiscountSummary({ r }: { r: Report }) {
  const withCode = r.discounts.filter((d) => d.code)
  const none = r.discounts.find((d) => !d.code)
  const orders = r.discounts.reduce((s, d) => s + d.orders, 0)
  const codeOrders = withCode.reduce((s, d) => s + d.orders, 0)
  const cost = withCode.reduce((s, d) => s + d.discount_cents, 0)
  const codeRevenue = withCode.reduce((s, d) => s + d.revenue_cents, 0)
  const firsts = withCode.reduce((s, d) => s + d.first_orders, 0)
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure label="Orders with a code" value={pct(share(codeOrders, orders))} note={`${codeOrders} of ${orders} orders`} />
      <Figure label="What codes cost" value={formatPrice(cost)} note={codeRevenue ? `${pct(share(cost, codeRevenue + cost))} off those orders` : undefined} />
      <Figure
        label="Average order with a code"
        value={codeOrders ? formatPrice(Math.round(codeRevenue / codeOrders)) : "—"}
        note={none ? `without one: ${formatPrice(none.average_order_cents)}` : undefined}
      />
      <Figure label="First orders with a code" value={firsts} note={codeOrders ? `${pct(share(firsts, codeOrders))} of code orders were a first order` : undefined} />
    </div>
  )
}

function Unpaid({ r, tables, fileBase }: { r: Report; tables: Tables; fileBase: string }) {
  const started = r.payments.reduce((s, p) => s + p.started, 0)
  const paid = r.payments.reduce((s, p) => s + p.paid, 0)
  const never = r.payments.reduce((s, p) => s + p.never_paid, 0)
  const waiting = r.payments.reduce((s, p) => s + p.waiting, 0)
  const lost = r.payments.reduce((s, p) => s + p.never_paid_cents, 0)
  return (
    <Section id="unpaid" title="Orders never paid" intro="Every order placed in the period — including card payments left unfinished and bank transfers that never arrived.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Orders placed" value={started} note={`${paid} paid`} />
        <Figure label="Never paid" value={pct(share(never, started))} note={`${never} ${never === 1 ? "order" : "orders"}, ${formatPrice(lost)}`} />
        <Figure label="Still waiting" value={waiting} note="not paid yet, not cancelled yet" />
        <Figure label="Paid" value={pct(share(paid, started))} note="of orders placed" />
      </div>
      <div className="mt-8">
        <ReportTable spec={tables.payments} filename={`${fileBase}-unpaid-orders`} empty="No orders were placed in this period." />
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Every table on the page, in one place (used for the page and the downloads)
// ---------------------------------------------------------------------------

function buildTables(r: Report) {
  const g = r.period.group
  const pieceRevenue = r.categories.reduce((s, c) => s + c.revenue_cents, 0)
  const ordersRevenue = r.countries.reduce((s, c) => s + c.revenue_cents, 0)
  const totalUnits = r.sizes.reduce((s, x) => s + x.units, 0)
  const totalColourUnits = r.colours.reduce((s, x) => s + x.units, 0)
  const allReturns = r.returns.reasons.reduce((s, x) => s + x.returns, 0)
  const through = (sold: number, stock: number) => (sold + stock === 0 ? null : sold / (sold + stock))

  const series: TableSpec<Report["series"][number]> = {
    name: `Sales by ${g}`,
    rows: r.series,
    columns: [
      { header: g === "day" ? "Day" : g === "week" ? "Week starting" : "Month", kind: "date", value: (b) => b.start },
      { header: "Orders", kind: "number", value: (b) => b.orders },
      { header: "Sales", kind: "money", value: (b) => b.revenue_cents },
      { header: "Orders, period before", kind: "number", value: (b) => b.previous_orders },
      { header: "Sales, period before", kind: "money", value: (b) => b.previous_revenue_cents },
    ],
  }

  const categories: TableSpec<Report["categories"][number]> = {
    name: "Categories",
    rows: r.categories,
    columns: [
      { header: "Category", kind: "text", value: (c) => c.category },
      { header: "Pieces", kind: "number", value: (c) => c.units },
      { header: "Sales", kind: "money", value: (c) => c.revenue_cents },
      { header: "Share of sales", kind: "percent", value: (c) => share(c.revenue_cents, pieceRevenue), render: (c) => <ShareBar value={share(c.revenue_cents, pieceRevenue)}>{pct(share(c.revenue_cents, pieceRevenue))}</ShareBar> },
      { header: "Period before", kind: "money", value: (c) => c.previous_revenue_cents, hideOnSmall: true },
      { header: "Change", kind: "percent", value: (c) => change(c.revenue_cents, c.previous_revenue_cents), render: (c) => <Change now={c.revenue_cents} before={c.previous_revenue_cents} /> },
      { header: "Returned pieces", kind: "number", value: (c) => c.returned_units, hideOnSmall: true },
    ],
  }

  const products: TableSpec<Report["products"][number]> = {
    name: "Pieces",
    rows: r.products,
    columns: [
      { header: "Piece", kind: "text", value: (p) => p.product },
      { header: "Category", kind: "text", value: (p) => p.category, hideOnSmall: true },
      { header: "Sold", kind: "number", value: (p) => p.units },
      { header: "Sales", kind: "money", value: (p) => p.revenue_cents },
      { header: "Period before", kind: "number", value: (p) => p.previous_units, hideOnSmall: true },
      { header: "Returned", kind: "number", value: (p) => p.returned_units },
      { header: "Return rate", kind: "percent", value: (p) => share(p.returned_units, p.units) },
      { header: "In stock now", kind: "number", value: (p) => p.stock, hideOnSmall: true },
    ],
  }

  const sizes: TableSpec<Report["sizes"][number]> = {
    name: "Sizes",
    rows: r.sizes,
    columns: [
      { header: "Size", kind: "text", value: (s) => s.size },
      { header: "Sold", kind: "number", value: (s) => s.units },
      { header: "Share", kind: "percent", value: (s) => share(s.units, totalUnits) },
      { header: "Returned", kind: "number", value: (s) => s.returned_units, hideOnSmall: true },
      { header: "In stock", kind: "number", value: (s) => s.stock },
      { header: "Sell-through", kind: "percent", value: (s) => through(s.units, s.stock) },
    ],
  }

  const colours: TableSpec<Report["colours"][number]> = {
    name: "Colours",
    rows: r.colours,
    columns: [
      { header: "Colour", kind: "text", value: (s) => s.colour },
      { header: "Sold", kind: "number", value: (s) => s.units },
      { header: "Share", kind: "percent", value: (s) => share(s.units, totalColourUnits) },
      { header: "Sales", kind: "money", value: (s) => s.revenue_cents, hideOnSmall: true },
      { header: "In stock", kind: "number", value: (s) => s.stock },
      { header: "Sell-through", kind: "percent", value: (s) => through(s.units, s.stock) },
    ],
  }

  const sitting: TableSpec<Report["sitting"][number]> = {
    name: "Not selling",
    rows: r.sitting,
    columns: [
      { header: "Piece", kind: "text", value: (s) => s.product },
      { header: "Colour", kind: "text", value: (s) => s.colour },
      { header: "Size", kind: "text", value: (s) => s.size },
      { header: "In stock", kind: "number", value: (s) => s.stock },
      { header: "Last sold", kind: "date", value: (s) => s.last_sold, render: (s) => (s.last_sold ? formatDay(s.last_sold, true) : <span className="text-muted-foreground">never</span>) },
      { header: "Category", kind: "text", value: (s) => s.category, hideOnSmall: true },
    ],
  }

  const c = r.customers
  const customers: TableSpec<{ label: string; customers: number | null; orders: number | null; revenue: number | null }> = {
    name: "Customers",
    rows: [
      { label: "New customers", customers: c.new, orders: c.new_orders, revenue: c.new_revenue_cents },
      { label: "Returning customers", customers: c.returning, orders: c.returning_orders, revenue: c.returning_revenue_cents },
      { label: "First-time customers in the period", customers: c.first_timers, orders: null, revenue: null },
      { label: "…of whom ordered again since", customers: c.first_timers_came_back, orders: null, revenue: null },
      { label: "All customers ever (to the end of the period)", customers: c.all_customers, orders: null, revenue: null },
      { label: "…with two or more orders", customers: c.all_repeat_customers, orders: null, revenue: null },
    ],
    columns: [
      { header: "", kind: "text", value: (x) => x.label },
      { header: "Customers", kind: "number", value: (x) => x.customers },
      { header: "Orders", kind: "number", value: (x) => x.orders },
      { header: "Sales", kind: "money", value: (x) => x.revenue },
    ],
  }

  const reasons: TableSpec<Report["returns"]["reasons"][number]> = {
    name: "Return reasons",
    rows: r.returns.reasons,
    columns: [
      { header: "Reason", kind: "text", value: (x) => reasonLabel(x.reason as ReturnReason) },
      { header: "Returns", kind: "number", value: (x) => x.returns },
      { header: "Share", kind: "percent", value: (x) => share(x.returns, allReturns), render: (x) => <ShareBar value={share(x.returns, allReturns)}>{pct(share(x.returns, allReturns))}</ShareBar> },
      { header: "Pieces", kind: "number", value: (x) => x.pieces },
      { header: "Refused", kind: "number", value: (x) => x.refused },
    ],
  }

  const discounts: TableSpec<Report["discounts"][number]> = {
    name: "Discount codes",
    rows: [...r.discounts].sort((a, b) => (a.code === "" ? 1 : b.code === "" ? -1 : b.orders - a.orders)),
    columns: [
      { header: "Code", kind: "text", value: (d) => d.code || "No code", render: (d) => (d.code ? <span className="font-mono">{d.code}</span> : <span className="text-muted-foreground">No code</span>) },
      { header: "Orders", kind: "number", value: (d) => d.orders },
      { header: "Sales", kind: "money", value: (d) => d.revenue_cents },
      { header: "Given away", kind: "money", value: (d) => d.discount_cents },
      { header: "Average order", kind: "money", value: (d) => d.average_order_cents },
      { header: "First orders", kind: "number", value: (d) => d.first_orders },
    ],
  }

  const payments: TableSpec<Report["payments"][number]> = {
    name: "Unpaid orders",
    rows: r.payments,
    columns: [
      { header: "Payment", kind: "text", value: (p) => (p.method === "card" ? "Card" : "Bank transfer") },
      { header: "Placed", kind: "number", value: (p) => p.started },
      { header: "Paid", kind: "number", value: (p) => p.paid },
      { header: "Never paid", kind: "number", value: (p) => p.never_paid },
      { header: "Share never paid", kind: "percent", value: (p) => share(p.never_paid, p.started) },
      { header: "Still waiting", kind: "number", value: (p) => p.waiting },
      { header: "Cancelled by you", kind: "number", value: (p) => p.cancelled_by_shop, hideOnSmall: true },
      { header: "Value never paid", kind: "money", value: (p) => p.never_paid_cents },
    ],
  }

  const countries: TableSpec<Report["countries"][number]> = {
    name: "Countries",
    rows: r.countries,
    columns: [
      { header: "Country", kind: "text", value: (x) => countryName(x.country) },
      { header: "Orders", kind: "number", value: (x) => x.orders },
      { header: "Sales", kind: "money", value: (x) => x.revenue_cents },
      { header: "Share of sales", kind: "percent", value: (x) => share(x.revenue_cents, ordersRevenue), render: (x) => <ShareBar value={share(x.revenue_cents, ordersRevenue)}>{pct(share(x.revenue_cents, ordersRevenue))}</ShareBar> },
      { header: "Customers", kind: "number", value: (x) => x.customers, hideOnSmall: true },
      { header: "Delivery charged", kind: "money", value: (x) => x.shipping_cents, hideOnSmall: true },
      { header: "To parcel lockers", kind: "number", value: (x) => x.locker_orders, hideOnSmall: true },
    ],
  }

  const summary: TableSpec<{ label: string; kind: CellKind; now: number; before: number }> = {
    name: "Summary",
    rows: [
      { label: "Sales", kind: "money", now: r.summary.current.revenue_cents, before: r.summary.previous.revenue_cents },
      { label: "Orders", kind: "number", now: r.summary.current.orders, before: r.summary.previous.orders },
      { label: "Pieces sold", kind: "number", now: r.summary.current.pieces, before: r.summary.previous.pieces },
      { label: "Customers", kind: "number", now: r.summary.current.customers, before: r.summary.previous.customers },
      { label: "Given in discounts", kind: "money", now: r.summary.current.discount_cents, before: r.summary.previous.discount_cents },
      { label: "Delivery charged", kind: "money", now: r.summary.current.shipping_cents, before: r.summary.previous.shipping_cents },
      { label: "VAT included", kind: "money", now: r.summary.current.vat_cents, before: r.summary.previous.vat_cents },
      { label: "Refunded", kind: "money", now: r.summary.current.refunded_cents, before: r.summary.previous.refunded_cents },
    ],
    columns: [
      { header: `${r.period.from} to ${r.period.to}`, kind: "text", value: (x) => x.label },
      { header: "This period", kind: "number", value: (x) => (x.kind === "money" ? x.now / 100 : x.now) },
      { header: "Period before", kind: "number", value: (x) => (x.kind === "money" ? x.before / 100 : x.before) },
      { header: "Change", kind: "percent", value: (x) => change(x.now, x.before) },
    ],
  }

  return {
    series,
    categories,
    products,
    sizes,
    colours,
    sitting,
    customers,
    reasons,
    discounts,
    payments,
    countries,
    all: [
      asSheet(summary),
      asSheet(series),
      asSheet(categories),
      asSheet(products),
      asSheet(sizes),
      asSheet(colours),
      asSheet(sitting),
      asSheet(customers),
      asSheet(reasons),
      asSheet(discounts),
      asSheet(payments),
      asSheet(countries),
    ] as Sheet<any>[],
  }
}
