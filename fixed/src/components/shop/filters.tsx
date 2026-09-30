import { useCallback, useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { variantPrice, type Product } from "@/lib/catalogue"
import { FAMILIES, familyOf, PRICE_BANDS, sortSizes } from "@/lib/search"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// State (kept in the address, so a filtered view can be shared or bookmarked)
// ---------------------------------------------------------------------------

export type Filters = { sizes: string[]; colours: string[]; price: string | null; inStock: boolean }

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : [])

export function useFilters() {
  const [params, setParams] = useSearchParams()
  const filters: Filters = useMemo(
    () => ({
      sizes: list(params.get("size")),
      colours: list(params.get("colour")),
      price: PRICE_BANDS.some((b) => b.key === params.get("price")) ? params.get("price") : null,
      inStock: params.get("stock") === "1",
    }),
    [params],
  )

  const update = useCallback(
    (change: Partial<Filters>) => {
      const next = new URLSearchParams(params)
      const f = { ...filters, ...change }
      const setList = (key: string, v: string[]) => (v.length ? next.set(key, v.join(",")) : next.delete(key))
      setList("size", f.sizes)
      setList("colour", f.colours)
      if (f.price) next.set("price", f.price)
      else next.delete("price")
      if (f.inStock) next.set("stock", "1")
      else next.delete("stock")
      setParams(next, { replace: true })
    },
    [params, setParams, filters],
  )

  const clear = useCallback(() => update({ sizes: [], colours: [], price: null, inStock: false }), [update])
  const count = filters.sizes.length + filters.colours.length + (filters.price ? 1 : 0) + (filters.inStock ? 1 : 0)
  return { filters, update, clear, count }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * A product matches when one of its colour-and-size combinations fits every
 * chosen size, colour family and (if asked) is in stock, at a price in the
 * chosen band.
 */
export function matches(p: Product, f: Filters) {
  const band = f.price ? PRICE_BANDS.find((b) => b.key === f.price) : null
  const familyByColour = new Map(p.colours.map((c) => [c.name, familyOf(c).key]))
  return p.product_variants.some((v) => {
    if (f.sizes.length && !f.sizes.includes(v.size)) return false
    if (f.colours.length && !f.colours.includes(familyByColour.get(v.colour) ?? "")) return false
    if (f.inStock && v.stock <= 0) return false
    if (band) {
      const price = variantPrice(p, v)
      if (price < band.min || price >= band.max) return false
    }
    return true
  })
}

export const applyFilters = (products: Product[], f: Filters) => products.filter((p) => matches(p, f))

/** Options that exist in the current set of products, with how many pieces each would leave. */
export function useFilterOptions(scope: Product[], f: Filters) {
  return useMemo(() => {
    const count = (change: Partial<Filters>) => applyFilters(scope, { ...f, ...change }).length
    // Each option counts as if it were chosen on its own (with the other groups applied).
    const sizes = sortSizes([...new Set(scope.flatMap((p) => p.sizes))]).map((s) => ({ value: s, count: count({ sizes: [s] }) }))
    const present = new Set(scope.flatMap((p) => p.colours.map((c) => familyOf(c).key)))
    const colours = FAMILIES.filter((fam) => present.has(fam.key)).map((fam) => ({ ...fam, count: count({ colours: [fam.key] }) }))
    const prices = PRICE_BANDS.map((b) => ({ ...b, count: count({ price: b.key }) })).filter((b) => b.count > 0 || f.price === b.key)
    const inStock = count({ inStock: true })
    return { sizes, colours, prices, inStock }
  }, [scope, f])
}

/** Human labels for the active filters, each with a way to remove it. */
export function activeFilters(f: Filters, update: (c: Partial<Filters>) => void) {
  const out: { key: string; label: string; remove: () => void }[] = []
  for (const s of f.sizes) out.push({ key: `s-${s}`, label: `Size ${s}`, remove: () => update({ sizes: f.sizes.filter((x) => x !== s) }) })
  for (const c of f.colours) {
    const fam = FAMILIES.find((x) => x.key === c)
    if (fam) out.push({ key: `c-${c}`, label: fam.label, remove: () => update({ colours: f.colours.filter((x) => x !== c) }) })
  }
  if (f.price) {
    const b = PRICE_BANDS.find((x) => x.key === f.price)
    if (b) out.push({ key: "price", label: b.label, remove: () => update({ price: null }) })
  }
  if (f.inStock) out.push({ key: "stock", label: "In stock", remove: () => update({ inStock: false }) })
  return out
}

// ---------------------------------------------------------------------------
// Pieces of UI
// ---------------------------------------------------------------------------

type Options = ReturnType<typeof useFilterOptions>

function SizeOptions({ options, f, update }: { options: Options; f: Filters; update: (c: Partial<Filters>) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.sizes.map((s) => {
        const on = f.sizes.includes(s.value)
        const empty = s.count === 0 && !on
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={on}
            disabled={empty}
            onClick={() => update({ sizes: on ? f.sizes.filter((x) => x !== s.value) : [...f.sizes, s.value] })}
            className={cn(
              "min-w-12 border px-3 py-2 text-sm transition-colors",
              on ? "border-foreground bg-foreground text-background" : "border-input hover:border-foreground",
              empty && "cursor-not-allowed opacity-35 hover:border-input",
            )}
          >
            {s.value}
          </button>
        )
      })}
    </div>
  )
}

function ColourOptions({ options, f, update }: { options: Options; f: Filters; update: (c: Partial<Filters>) => void }) {
  return (
    <ul className="grid gap-1">
      {options.colours.map((c) => {
        const on = f.colours.includes(c.key)
        return (
          <li key={c.key}>
            <button
              type="button"
              aria-pressed={on}
              disabled={c.count === 0 && !on}
              onClick={() => update({ colours: on ? f.colours.filter((x) => x !== c.key) : [...f.colours, c.key] })}
              className="flex w-full items-center gap-3 px-1 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-35"
            >
              <span className={cn("relative size-6 shrink-0 rounded-full ring-1 ring-black/10 ring-inset", on && "ring-2 ring-foreground ring-offset-2 ring-offset-popover")} style={{ background: c.swatch }}>
                {on && <Check className="absolute inset-0 m-auto size-3.5 text-white mix-blend-difference" />}
              </span>
              <span className="flex-1">{c.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{c.count}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function PriceOptions({ options, f, update }: { options: Options; f: Filters; update: (c: Partial<Filters>) => void }) {
  return (
    <ul className="grid gap-1">
      {options.prices.map((b) => {
        const on = f.price === b.key
        return (
          <li key={b.key}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => update({ price: on ? null : b.key })}
              className="flex w-full items-center gap-3 px-1 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-foreground" : "border-input")}>
                {on && <span className="size-2 rounded-full bg-foreground" />}
              </span>
              <span className="flex-1">{b.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{b.count}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function StockSwitch({ f, update, count }: { f: Filters; update: (c: Partial<Filters>) => void; count: number }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={f.inStock}
      onClick={() => update({ inStock: !f.inStock })}
      className="flex items-center gap-2.5 text-sm"
    >
      <span className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", f.inStock ? "bg-foreground" : "bg-input")}>
        <span className={cn("inline-block size-4 rounded-full bg-background shadow transition-transform", f.inStock ? "translate-x-4.5" : "translate-x-0.5")} />
      </span>
      Only what's in stock
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
    </button>
  )
}

function Dropdown({ label, selected, onClear, children }: { label: string; selected: number; onClear: () => void; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-11 items-center gap-1.5 border px-3 text-sm transition-colors data-[state=open]:border-foreground md:h-9",
            selected ? "border-foreground" : "border-input hover:border-foreground/50",
          )}
        >
          {label}
          {selected > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-[0.7rem] text-background">{selected}</span>}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        {children}
        {selected > 0 && (
          <button type="button" onClick={onClear} className="mt-4 text-xs underline underline-offset-4">
            Clear {label.toLowerCase()}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Desktop: a row of small dropdowns. */
export function FilterBar({ options, f, update }: { options: Options; f: Filters; update: (c: Partial<Filters>) => void }) {
  return (
    <div className="hidden flex-wrap items-center gap-2 md:flex">
      <Dropdown label="Size" selected={f.sizes.length} onClear={() => update({ sizes: [] })}>
        <p className="eyebrow mb-3">Size</p>
        <SizeOptions options={options} f={f} update={update} />
      </Dropdown>
      <Dropdown label="Colour" selected={f.colours.length} onClear={() => update({ colours: [] })}>
        <p className="eyebrow mb-2">Colour</p>
        <ColourOptions options={options} f={f} update={update} />
      </Dropdown>
      <Dropdown label="Price" selected={f.price ? 1 : 0} onClear={() => update({ price: null })}>
        <p className="eyebrow mb-2">Price</p>
        <PriceOptions options={options} f={f} update={update} />
      </Dropdown>
      <span className="mx-2 h-5 w-px bg-border" aria-hidden />
      <StockSwitch f={f} update={update} count={options.inStock} />
    </div>
  )
}

/** Phone: one button that opens a panel from the bottom. */
export function FilterSheetButton({
  options,
  f,
  update,
  clear,
  active,
  resultCount,
}: {
  options: Options
  f: Filters
  update: (c: Partial<Filters>) => void
  clear: () => void
  active: number
  resultCount: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-11 items-center gap-2 border border-input px-3 text-sm md:hidden">
        <SlidersHorizontal className="size-4" strokeWidth={1.5} />
        Filters
        {active > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-[0.7rem] text-background">{active}</span>}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="flex h-[85svh] flex-col gap-0 bg-background p-0">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="font-serif text-xl font-normal">Filters</SheetTitle>
            <SheetDescription className="sr-only">Narrow the pieces by size, colour, price and stock.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-8 overflow-y-auto px-5 py-6">
            <StockSwitch f={f} update={update} count={options.inStock} />
            <section>
              <h3 className="eyebrow mb-3 font-sans">Size</h3>
              <SizeOptions options={options} f={f} update={update} />
            </section>
            <section>
              <h3 className="eyebrow mb-2 font-sans">Colour</h3>
              <ColourOptions options={options} f={f} update={update} />
            </section>
            <section>
              <h3 className="eyebrow mb-2 font-sans">Price</h3>
              <PriceOptions options={options} f={f} update={update} />
            </section>
          </div>
          <div className="flex items-center gap-3 border-t bg-linen px-5 py-4">
            <Button variant="ghost" onClick={clear} disabled={active === 0} className="h-12 rounded-none">
              Clear all
            </Button>
            <Button onClick={() => setOpen(false)} className="h-12 flex-1 rounded-none text-[0.8rem] tracking-[0.1em] uppercase">
              {resultCount === 0 ? "Nothing matches" : `Show ${resultCount} ${resultCount === 1 ? "piece" : "pieces"}`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export function ActiveFilterChips({ f, update, clear }: { f: Filters; update: (c: Partial<Filters>) => void; clear: () => void }) {
  const chips = activeFilters(f, update)
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button key={c.key} type="button" onClick={c.remove} className="flex items-center gap-1.5 bg-sand px-3 py-1.5 text-xs hover:bg-accent" aria-label={`Remove ${c.label}`}>
          {c.label} <X className="size-3" />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={clear} className="px-2 text-xs underline underline-offset-4">
          Clear all
        </button>
      )}
    </div>
  )
}
