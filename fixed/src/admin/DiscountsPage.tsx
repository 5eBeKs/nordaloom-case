import { useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Check, Copy, Plus, Shuffle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  codeStatus,
  deleteDiscountCode,
  describeDiscount,
  saveDiscountCode,
  useDiscountCodes,
  type DiscountCode,
  type DiscountInput,
} from "@/lib/discounts"
import { dateShort } from "@/lib/admin"
import { formatPrice, shopDay, shopDayStart } from "@/lib/format"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, PageHeader, Toggle } from "./ui"

export function DiscountsPage() {
  useTitle("Discount codes")
  const { data: codes = [], isLoading } = useDiscountCodes()
  const [editing, setEditing] = useState<DiscountCode | "new" | null>(null)

  const given = codes.reduce((s, c) => s + c.given_cents, 0)
  const uses = codes.reduce((s, c) => s + c.uses, 0)
  const live = codes.filter((c) => codeStatus(c).tone !== "off").length

  return (
    <div className="space-y-8">
      <PageHeader
        title="Discount codes"
        intro="Customers type a code in their bag. A use counts once an order is placed with it; if the order is cancelled, the use is given back."
        actions={
          <Button onClick={() => setEditing("new")} className="h-11 rounded-none px-6">
            <Plus className="size-4" /> New code
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-px border bg-border sm:max-w-2xl">
        <Figure label="Codes in use" value={String(live)} />
        <Figure label="Orders with a code" value={String(uses)} />
        <Figure label="Given away (paid orders)" value={formatPrice(given)} />
      </div>

      {isLoading ? (
        <Empty>Loading codes…</Empty>
      ) : codes.length === 0 ? (
        <div className="border border-dashed py-16 text-center">
          <p className="font-serif text-2xl font-light">No discount codes yet.</p>
          <p className="mt-2 text-muted-foreground">Start with a welcome code for the newsletter, like WELCOME10.</p>
          <Button onClick={() => setEditing("new")} className="mt-6 h-11 rounded-none px-6">
            Create a code
          </Button>
        </div>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {codes.map((c) => (
            <CodeCard key={c.id} code={c} onEdit={() => setEditing(c)} />
          ))}
        </ul>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto bg-background p-0 sm:max-w-lg">
          {editing !== null && <CodeEditor key={editing === "new" ? "new" : editing.id} code={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function rules(c: Pick<DiscountCode, "min_order_cents" | "ends_at" | "max_uses" | "first_order_only" | "once_per_customer">) {
  const out: string[] = []
  if (c.first_order_only) out.push("First order only")
  if (c.once_per_customer) out.push("Once per customer")
  if (c.min_order_cents) out.push(`Orders from ${formatPrice(c.min_order_cents)}`)
  if (c.ends_at) out.push(`Until ${dateShort.format(new Date(new Date(c.ends_at).getTime() - 1000))}`)
  if (c.max_uses) out.push(`${c.max_uses} uses in total`)
  return out
}

function CodeCard({ code: c, onEdit }: { code: DiscountCode; onEdit: () => void }) {
  const queryClient = useQueryClient()
  const status = codeStatus(c)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-discounts"] })

  async function toggleActive(active: boolean) {
    setBusy(true)
    const { id: _id, created_at: _c, uses: _u, paid_uses: _p, given_cents: _g, pending_cents: _pe, sales_cents: _s, last_used_at: _l, ...input } = c
    const res = await saveDiscountCode({ ...input, is_active: active }, c.id)
    setBusy(false)
    if (!res.ok) toast.error("That didn't work — please try again.")
    else {
      toast.success(active ? `${c.code} is active again.` : `${c.code} is paused — customers can't use it.`)
      void refresh()
    }
  }

  return (
    <li className={cn("flex flex-col border bg-card p-6", status.tone === "off" && "opacity-75")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(c.code).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }
            className="group flex items-center gap-2 font-mono text-2xl tracking-wider"
            title="Copy code"
          >
            {c.code}
            {copied ? <Check className="size-4 text-moss" /> : <Copy className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
          </button>
          <p className="mt-1 font-serif text-lg text-clay">{describeDiscount(c)}</p>
        </div>
        <span
          className={cn(
            "shrink-0 px-2 py-1 text-[0.7rem] font-semibold tracking-[0.1em] uppercase",
            status.tone === "live" && "bg-moss/15 text-moss",
            status.tone === "warn" && "bg-clay/15 text-clay",
            status.tone === "off" && "bg-muted text-muted-foreground",
          )}
        >
          {status.label}
        </span>
      </div>

      {rules(c).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {rules(c).map((r) => (
            <span key={r} className="bg-sand px-2 py-0.5 text-xs">
              {r}
            </span>
          ))}
        </div>
      )}
      {c.note && <p className="mt-3 text-sm text-muted-foreground">{c.note}</p>}

      <dl className="mt-5 grid grid-cols-3 gap-4 border-t pt-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Used</dt>
          <dd className="mt-1 font-serif text-2xl font-light tabular-nums">
            {c.uses}
            {c.max_uses && <span className="text-base text-muted-foreground"> / {c.max_uses}</span>}
          </dd>
          {c.max_uses && (
            <span className="mt-2 block h-1 w-full bg-muted">
              <span className="block h-full bg-foreground" style={{ width: `${Math.min(100, (c.uses / c.max_uses) * 100)}%` }} />
            </span>
          )}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Given away</dt>
          <dd className="mt-1 font-serif text-2xl font-light tabular-nums">{formatPrice(c.given_cents)}</dd>
          {c.pending_cents > 0 && <p className="text-xs text-muted-foreground">+{formatPrice(c.pending_cents)} awaiting payment</p>}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Sales with it</dt>
          <dd className="mt-1 font-serif text-2xl font-light tabular-nums">{formatPrice(c.sales_cents)}</dd>
          {c.last_used_at && <p className="text-xs text-muted-foreground">Last {dateShort.format(new Date(c.last_used_at))}</p>}
        </div>
      </dl>

      <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4">
        <label className="flex items-center gap-2 text-sm">
          <Toggle checked={c.is_active} onChange={(v) => void toggleActive(v)} disabled={busy} label={c.is_active ? `Pause ${c.code}` : `Activate ${c.code}`} />
          {c.is_active ? "On" : "Paused"}
        </label>
        <button type="button" onClick={onEdit} className="text-sm underline underline-offset-4">
          Edit
        </button>
      </div>
    </li>
  )
}

const randomCode = () => {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return "NORDA" + Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join("")
}

function toDateInput(iso: string | null) {
  if (!iso) return ""
  // ends_at is the moment the code stops working (midnight, in the shop's time, after the last day).
  return shopDay(new Date(iso).getTime() - 1000)
}

function CodeEditor({ code, onDone }: { code: DiscountCode | null; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [f, setF] = useState({
    code: code?.code ?? "",
    kind: code?.kind ?? ("percent" as "percent" | "fixed"),
    value: code ? (code.kind === "percent" ? String(code.value) : (code.value / 100).toFixed(2).replace(/\.00$/, "")) : "",
    min: code?.min_order_cents ? (code.min_order_cents / 100).toFixed(2).replace(/\.00$/, "") : "",
    ends: toDateInput(code?.ends_at ?? null),
    maxUses: code?.max_uses ? String(code.max_uses) : "",
    first: code?.first_order_only ?? false,
    once: code?.once_per_customer ?? false,
    active: code?.is_active ?? true,
    note: code?.note ?? "",
  })
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((x) => ({ ...x, [k]: v }))
    setError("")
  }
  const euros = (v: string) => Math.round(parseFloat(v.replace(",", ".")) * 100)
  const today = toDateInput(new Date(Date.now() + 1000).toISOString())

  async function save() {
    const codeText = f.code.trim().toUpperCase()
    if (!/^[A-Z0-9_-]{3,30}$/.test(codeText)) return setError("The code needs 3–30 letters, numbers, - or _ (no spaces).")
    const value = f.kind === "percent" ? Number(f.value) : euros(f.value)
    if (!Number.isFinite(value) || value <= 0 || (f.kind === "percent" && (value > 100 || !Number.isInteger(value))))
      return setError(f.kind === "percent" ? "Enter a whole percentage between 1 and 100." : "Enter an amount above €0.")
    const min = f.min.trim() ? euros(f.min) : null
    if (min !== null && !(min > 0)) return setError("The minimum order must be above €0, or empty.")
    const maxUses = f.maxUses.trim() ? Number(f.maxUses) : null
    if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses > 0)) return setError("The limit must be a whole number, or empty.")
    // Valid through the whole chosen day in the shop's time: until the next day begins there.
    const endsAt = f.ends ? shopDayStart(shopDay(shopDayStart(f.ends).getTime() + 36 * 3_600_000)).getTime() : null

    const input: DiscountInput = {
      code: codeText,
      kind: f.kind,
      value,
      min_order_cents: min,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      max_uses: maxUses,
      first_order_only: f.first,
      once_per_customer: f.once,
      is_active: f.active,
      note: f.note.trim(),
    }
    setSaving(true)
    const res = await saveDiscountCode(input, code?.id)
    setSaving(false)
    if (!res.ok) return setError(res.code === "duplicate" ? `There's already a code called ${codeText}.` : "Something went wrong saving. Please try again.")
    toast.success(code ? `${codeText} saved.` : `${codeText} is ready to use.`)
    void queryClient.invalidateQueries({ queryKey: ["admin-discounts"] })
    onDone()
  }

  async function remove() {
    if (!code || !window.confirm(`Delete ${code.code}? This can't be undone.`)) return
    setDeleting(true)
    const err = await deleteDiscountCode(code.id)
    setDeleting(false)
    if (err === "code_in_use") return setError("This code has been used in orders, so it can't be deleted — pause it instead.")
    if (err) return setError("Something went wrong. Please try again.")
    toast(`${code.code} deleted.`)
    void queryClient.invalidateQueries({ queryKey: ["admin-discounts"] })
    onDone()
  }

  const preview = describeDiscount({ kind: f.kind, value: f.kind === "percent" ? Number(f.value) : euros(f.value) })

  return (
    <>
      <SheetHeader className="border-b px-6 py-5">
        <SheetTitle className="font-serif text-2xl font-normal">{code ? `Edit ${code.code}` : "New discount code"}</SheetTitle>
        <SheetDescription>{code && code.uses > 0 ? `Used ${code.uses} ${code.uses === 1 ? "time" : "times"} so far.` : "Customers type this code in their bag."}</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-7 px-6 py-6">
        <Field label="Code">
          <div className="flex gap-2">
            <Input
              value={f.code}
              onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s/g, ""))}
              placeholder="WELCOME10"
              maxLength={30}
              className="h-11 flex-1 rounded-none bg-card font-mono tracking-wider uppercase"
            />
            <button type="button" onClick={() => set("code", randomCode())} className="flex items-center gap-1.5 border px-3 text-sm hover:border-foreground" title="Make up a code">
              <Shuffle className="size-4" /> Generate
            </button>
          </div>
        </Field>

        <Field label="What it takes off">
          <div className="flex">
            {(["percent", "fixed"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set("kind", k)}
                className={cn("flex-1 border px-4 py-2.5 text-sm", f.kind === k ? "border-foreground bg-foreground text-background" : "border-input")}
              >
                {k === "percent" ? "A percentage" : "A fixed amount"}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="relative w-36">
              <Input value={f.value} onChange={(e) => set("value", e.target.value)} inputMode="decimal" placeholder={f.kind === "percent" ? "10" : "20"} className="h-11 rounded-none bg-card pr-8" />
              <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">{f.kind === "percent" ? "%" : "€"}</span>
            </div>
            {preview && <span className="font-serif text-lg text-clay">{preview}</span>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Taken off the pieces, not delivery. Free delivery counts from the amount after the discount.</p>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Minimum order" hint="optional">
            <div className="relative">
              <Input value={f.min} onChange={(e) => set("min", e.target.value)} inputMode="decimal" placeholder="None" className="h-11 rounded-none bg-card pr-8" />
              <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">€</span>
            </div>
          </Field>
          <Field label="Last day" hint="optional">
            <Input type="date" value={f.ends} min={code ? undefined : today} onChange={(e) => set("ends", e.target.value)} className="h-11 rounded-none bg-card" />
          </Field>
          <Field label="Uses in total" hint="optional">
            <Input value={f.maxUses} onChange={(e) => set("maxUses", e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="No limit" className="h-11 rounded-none bg-card" />
          </Field>
        </div>

        <div className="space-y-4 border-y py-5">
          <SwitchRow label="First order only" hint="Not for anyone who has ordered before (by account or email)" checked={f.first} onChange={(v) => set("first", v)} />
          <SwitchRow label="Once per customer" hint="Each customer can use it one time" checked={f.once} onChange={(v) => set("once", v)} />
          <SwitchRow label="Active" hint="Pause a code without deleting it" checked={f.active} onChange={(v) => set("active", v)} />
        </div>

        <Field label="Note for yourself" hint="optional">
          <Input value={f.note} onChange={(e) => set("note", e.target.value)} maxLength={200} placeholder="e.g. Newsletter welcome, autumn 2026" className="h-11 rounded-none bg-card" />
        </Field>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t bg-linen px-6 py-4">
        {code && code.uses === 0 ? (
          <Button variant="ghost" onClick={() => void remove()} disabled={deleting} className="h-11 rounded-none text-muted-foreground">
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={() => void save()} disabled={saving} className="h-11 rounded-none px-8">
          {saving ? "Saving…" : code ? "Save changes" : "Create code"}
        </Button>
      </div>
    </>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-4">
      <p className="font-serif text-3xl font-light tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="flex items-baseline justify-between text-sm">
        {label}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </p>
      {children}
    </div>
  )
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">
        {label}
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}
