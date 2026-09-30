import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Mail } from "lucide-react"
import { ProductImage } from "@/components/art/ProductImage"
import { ReturnBadge, StatusBadge } from "@/components/Badges"
import { dateShort, useCustomer, useCustomers } from "@/lib/admin"
import { countryName } from "@/lib/checkout"
import { formatPrice } from "@/lib/format"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, FilterTabs, PageHeader, Panel, SearchInput } from "./ui"

type Filter = "all" | "account" | "guest" | "buyers"

export function CustomersPage() {
  useTitle("Customers")
  const { data: customers = [], isLoading } = useCustomers()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customers.filter(
      (c) =>
        (filter === "all" || (filter === "account" ? !!c.user_id : filter === "guest" ? !c.user_id : c.orders > 0)) &&
        (!q || c.email.includes(q) || (c.name ?? "").toLowerCase().includes(q)),
    )
  }, [customers, search, filter])

  const counts = {
    all: customers.length,
    account: customers.filter((c) => c.user_id).length,
    guest: customers.filter((c) => !c.user_id).length,
    buyers: customers.filter((c) => c.orders > 0).length,
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Customers" intro="Everyone with an account, and everyone who has ordered as a guest." />
      <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email" className="max-w-xl" />
      <div>
        <FilterTabs
          options={[
            { key: "all" as const, label: "All" },
            { key: "buyers" as const, label: "Have ordered" },
            { key: "account" as const, label: "With an account" },
            { key: "guest" as const, label: "Guests" },
          ]}
          value={filter}
          onChange={setFilter}
          counts={counts}
        />
        {isLoading ? (
          <Empty>Loading customers…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{customers.length === 0 ? "No customers yet." : "Nobody matches."}</Empty>
        ) : (
          <ul className="divide-y border-b">
            {shown.map((c) => (
              <li key={c.email}>
                <Link to={`/admin/customers/${encodeURIComponent(c.email)}`} className="grid grid-cols-12 items-center gap-3 px-2 py-4 text-sm hover:bg-sand/50">
                  <span className="col-span-12 flex min-w-0 items-center gap-3 sm:col-span-5">
                    <Initials name={c.name ?? c.email} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name ?? "—"}</span>
                      <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                    </span>
                  </span>
                  <span className="col-span-4 text-xs text-muted-foreground sm:col-span-2">
                    {c.user_id ? "Account" : "Guest"}
                    {c.newsletter && <span className="block">Newsletter</span>}
                  </span>
                  <span className="col-span-4 sm:col-span-2">
                    {c.orders} {c.orders === 1 ? "order" : "orders"}
                    {c.country && <span className="block text-xs text-muted-foreground">{countryName(c.country)}</span>}
                  </span>
                  <span className="col-span-4 text-right tabular-nums sm:col-span-3">
                    {formatPrice(c.spent_cents)}
                    <span className="block text-xs text-muted-foreground">
                      {c.last_order_at ? `Last order ${dateShort.format(new Date(c.last_order_at))}` : c.registered_at ? `Joined ${dateShort.format(new Date(c.registered_at))}` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function CustomerDetailPage() {
  const { email } = useParams()
  const { data: c, isLoading } = useCustomer(email)
  useTitle(c?.name ?? "Customer")

  if (isLoading) return <Empty>Loading…</Empty>
  if (!c) return <Empty>No customer with that email.</Empty>

  const live = c.orders.filter((o) => o.status !== "cancelled")
  // Money that was refunded is not money spent.
  const paidFor = c.orders.filter((o) => ["paid", "shipped", "delivered"].includes(o.status))
  const spent = paidFor.reduce((s, o) => s + Math.max(0, o.total_cents - o.refunded_cents), 0)
  const refunded = c.orders.reduce((s, o) => s + o.refunded_cents, 0)
  const pieces = live.reduce((n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0), 0)
  const latest = c.orders[0]

  return (
    <div className="space-y-8">
      <Link to="/admin/customers" className="-my-2 inline-flex items-center gap-1 py-2.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <header className="flex flex-wrap items-center gap-5">
        <Initials name={c.name ?? c.email} large />
        <div>
          <h1 className="text-4xl font-light">{c.name ?? c.email}</h1>
          <a href={`mailto:${c.email}`} className="mt-1 inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline">
            <Mail className="size-3.5" /> {c.email}
          </a>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-px border bg-border md:grid-cols-5">
        <Fig label="Orders" value={String(live.length)} />
        <Fig label="Spent" value={formatPrice(spent)} />
        <Fig label="Refunded" value={formatPrice(refunded)} />
        <Fig label="Pieces bought" value={String(pieces)} />
        <Fig label="Average order" value={live.length ? formatPrice(Math.round(spent / Math.max(1, paidFor.length))) : "—"} wide />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <h2 className="text-2xl">What they ordered</h2>
          {c.orders.length === 0 && <p className="text-muted-foreground">No orders yet.</p>}
          {c.orders.map((o) => (
            <article key={o.id} className="border bg-card">
              <Link to={`/admin/orders/${o.order_number}`} className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 hover:bg-sand/40">
                <span>
                  <span className="font-medium">{o.order_number}</span>
                  <span className="ml-3 text-sm text-muted-foreground">{dateShort.format(new Date(o.created_at))}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm tabular-nums">{formatPrice(o.total_cents)}</span>
                  <StatusBadge status={o.status} />
                </span>
              </Link>
              <ul className="divide-y px-5">
                {o.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 py-3 text-sm">
                    <span className="block aspect-[4/5] w-10 shrink-0 overflow-hidden bg-muted">
                      <ProductImage product={{ slug: i.product_slug, category_slug: "", name: i.product_name, images: i.product_image ? [i.product_image] : [], colours: [] }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{i.product_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {i.colour}
                        {i.size !== "One size" && <> · {i.size}</>} · ×{i.quantity}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatPrice(i.line_total_cents)}</span>
                  </li>
                ))}
              </ul>
              {o.returns.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t px-5 py-3">
                  {o.returns.map((r) => (
                    <Link key={r.return_number} to="/admin/returns?status=all" className="flex items-center gap-2 text-xs">
                      {r.return_number} <ReturnBadge status={r.status} />
                    </Link>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>

        <div className="space-y-6">
          <Panel title="About">
            <dl className="space-y-3 text-sm">
              <Item label="Account">{c.user_id ? `Since ${dateShort.format(new Date(c.registered_at!))}` : "Ordered as a guest"}</Item>
              {c.last_sign_in_at && <Item label="Last signed in">{dateShort.format(new Date(c.last_sign_in_at))}</Item>}
              {latest && <Item label="Phone">{latest.phone}</Item>}
              <Item label="Newsletter">{c.newsletter ? "Subscribed" : "Not subscribed"}</Item>
            </dl>
          </Panel>
          <Panel title={c.addresses.length ? "Saved addresses" : "Last delivery address"}>
            {c.addresses.length > 0 ? (
              <ul className="space-y-4 text-sm">
                {c.addresses.map((a) => (
                  <li key={a.id}>
                    <p className="font-medium">
                      {a.label || a.full_name} {a.is_default && <span className="ml-1 text-xs font-normal text-muted-foreground">(default)</span>}
                    </p>
                    <p className="text-muted-foreground">
                      {a.address_line1}
                      {a.address_line2 && `, ${a.address_line2}`}, {a.postal_code} {a.city}, {countryName(a.country)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : latest ? (
              <p className="text-sm text-muted-foreground">
                {latest.address_line1}
                {latest.address_line2 && `, ${latest.address_line2}`}
                <br />
                {latest.postal_code} {latest.city}, {countryName(latest.country)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">None yet.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function Initials({ name, large }: { name: string; large?: boolean }) {
  const letters = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-sand font-serif text-foreground/80", large ? "size-16 text-2xl" : "size-9 text-sm")}>
      {letters || "?"}
    </span>
  )
}

function Fig({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 bg-card p-5 md:col-span-1" : "bg-card p-5"}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-serif text-3xl font-light tabular-nums">{value}</p>
    </div>
  )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}
