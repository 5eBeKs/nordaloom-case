import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { toast } from "sonner"
import { ProductImage } from "@/components/art/ProductImage"
import { swatchBackground } from "@/components/art/colour"
import { setStock, useAdminProducts, type AdminProduct } from "@/lib/admin"
import { useCategories, type Variant } from "@/lib/catalogue"
import { useShopSettings } from "@/lib/checkout"
import { DEMO_CATALOGUE_OFF, demoRefused } from "@/lib/demo"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, PageHeader, SearchInput, Toggle } from "./ui"

export function StockPage() {
  useTitle("Stock")
  const [params, setParams] = useSearchParams()
  const { data: products = [], isLoading } = useAdminProducts()
  const { data: categories = [] } = useCategories()
  const { data: settings } = useShopSettings()
  const threshold = settings?.low_stock_threshold ?? 2
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("all")
  const onlyLow = params.get("filter") === "low"
  const focusProduct = params.get("product")

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(
      (p) =>
        (!focusProduct || p.id === focusProduct) &&
        (category === "all" || p.category_slug === category) &&
        (!q || p.name.toLowerCase().includes(q)) &&
        (!onlyLow || p.product_variants.some((v) => v.stock <= threshold)),
    )
  }, [products, search, category, onlyLow, threshold, focusProduct])

  const totals = useMemo(() => {
    const all = products.flatMap((p) => (p.is_published ? p.product_variants : []))
    return { pieces: all.reduce((n, v) => n + v.stock, 0), soldOut: all.filter((v) => v.stock === 0).length, low: all.filter((v) => v.stock > 0 && v.stock <= threshold).length }
  }, [products, threshold])

  const grouped = categories
    .map((c) => ({ category: c, products: shown.filter((p) => p.category_slug === c.slug) }))
    .filter((g) => g.products.length > 0)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Stock"
        intro="Type a number and press Enter — it saves straight away. Use Enter and the arrow keys to move between sizes."
      />

      <div className="grid grid-cols-3 gap-px border bg-border sm:max-w-xl">
        <Figure label="Pieces in the shop" value={totals.pieces} />
        <Figure label={`Low (${threshold} or fewer)`} value={totals.low} tone={totals.low ? "clay" : undefined} />
        <Figure label="Sold out" value={totals.soldOut} tone={totals.soldOut ? "red" : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name" className="w-full max-w-xs" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-11 border border-input bg-card px-3 text-sm" aria-label="Category">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <Toggle
            checked={onlyLow}
            onChange={(v) => {
              const next = new URLSearchParams(params)
              if (v) next.set("filter", "low")
              else next.delete("filter")
              setParams(next, { replace: true })
            }}
            label="Only running low"
          />
          Only running low
        </label>
        {focusProduct && (
          <button
            onClick={() => {
              const next = new URLSearchParams(params)
              next.delete("product")
              setParams(next, { replace: true })
            }}
            className="text-sm underline underline-offset-4"
          >
            Show all products
          </button>
        )}
      </div>

      {isLoading ? (
        <Empty>Loading stock…</Empty>
      ) : grouped.length === 0 ? (
        <Empty>{onlyLow ? "Nothing is running low." : "No products match."}</Empty>
      ) : (
        <div className="space-y-12">
          {grouped.map((g) => (
            <section key={g.category.slug}>
              <h2 className="border-b pb-3 text-2xl">{g.category.name}</h2>
              <div className="divide-y">
                {g.products.map((p) => (
                  <ProductStock key={p.id} product={p} threshold={threshold} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "clay" | "red" }) {
  return (
    <div className="bg-card p-4">
      <p className={cn("font-serif text-3xl font-light tabular-nums", tone === "clay" && "text-clay", tone === "red" && "text-destructive")}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function ProductStock({ product: p, threshold }: { product: AdminProduct; threshold: number }) {
  const total = p.product_variants.reduce((n, v) => n + v.stock, 0)
  const find = (colour: string, size: string) => p.product_variants.find((v) => v.colour === colour && v.size === size)

  return (
    <article className="grid gap-6 py-6 md:grid-cols-[12rem_1fr]">
      <div className="flex items-start gap-4 md:block">
        <Link to={`/admin/products/${p.id}`} className="block aspect-[4/5] w-16 shrink-0 overflow-hidden bg-muted md:w-24">
          <ProductImage product={p} />
        </Link>
        <div className="md:mt-3">
          <Link to={`/admin/products/${p.id}`} className="font-medium hover:underline">
            {p.name}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {total} in stock
            {!p.is_published && <span className="ml-2 bg-muted px-1.5 py-0.5 tracking-wide uppercase">Hidden</span>}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="sr-only">Colour</th>
              {p.sizes.map((s) => (
                <th key={s} scope="col" className="max-w-16 px-0.5 pb-1 text-center align-bottom text-xs leading-tight font-normal text-muted-foreground">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.colours.map((c, r) => (
              <tr key={c.name}>
                <th scope="row" className="pr-2 text-left font-normal whitespace-nowrap sm:pr-3">
                  <span className="flex max-w-[5.5rem] items-center gap-2 sm:max-w-none" title={c.name}>
                    <span className="size-3.5 shrink-0 rounded-full ring-1 ring-black/10 ring-inset" style={{ background: swatchBackground(c) }} />
                    <span className="truncate">{c.name}</span>
                  </span>
                </th>
                {p.sizes.map((s, col) => {
                  const v = find(c.name, s)
                  return (
                    <td key={s}>
                      {v ? (
                        <StockCell variant={v} threshold={threshold} grid={p.id} row={r} col={col} label={`${p.name}, ${c.name}, ${s}`} />
                      ) : (
                        <span className="block w-10 text-center text-muted-foreground sm:w-16">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}

function StockCell({ variant, threshold, grid, row, col, label }: { variant: Variant; threshold: number; grid: string; row: number; col: number; label: string }) {
  const queryClient = useQueryClient()
  const [known, setKnown] = useState(variant.stock)
  const [value, setValue] = useState(String(variant.stock))
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const editing = useRef(false)
  const skipCommit = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Follow the server's number unless it's being typed over.
  useEffect(() => {
    if (!editing.current) {
      setKnown(variant.stock)
      setValue(String(variant.stock))
    }
  }, [variant.stock])

  async function commit() {
    editing.current = false
    if (skipCommit.current) {
      skipCommit.current = false
      return
    }
    const n = Number(value.trim())
    if (value.trim() === "" || !Number.isInteger(n) || n < 0) {
      setValue(String(known))
      return
    }
    if (n === known) return
    setState("saving")
    try {
      const res = await setStock({ id: variant.id, stock: known }, n)
      setKnown(res.stock)
      setValue(String(res.stock))
      if (res.ok) {
        setState("saved")
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setState("idle"), 1500)
      } else {
        setState("idle")
        toast(`${label}: a piece sold while you were typing — there are now ${res.stock}. Check and enter the number again.`)
      }
      void queryClient.invalidateQueries({ queryKey: ["products"] })
      void queryClient.invalidateQueries({ queryKey: ["product"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] })
    } catch (e) {
      setState("error")
      setValue(String(known))
      toast.error(demoRefused(e) ? DEMO_CATALOGUE_OFF : `Couldn't save ${label}.`)
    }
  }

  function move(e: KeyboardEvent<HTMLInputElement>, dr: number) {
    e.preventDefault()
    const target = document.querySelector<HTMLInputElement>(`input[data-grid="${grid}"][data-r="${row + dr}"][data-c="${col}"]`)
    if (target) {
      target.focus()
      target.select()
    } else {
      e.currentTarget.blur()
    }
  }

  const n = Number(value)
  return (
    <span className="relative block">
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        data-grid={grid}
        data-r={row}
        data-c={col}
        value={value}
        onFocus={(e) => {
          editing.current = true
          e.target.select()
        }}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "ArrowDown") move(e, 1)
          else if (e.key === "ArrowUp") move(e, -1)
          else if (e.key === "Escape") {
            skipCommit.current = true
            setValue(String(known))
            e.currentTarget.blur()
          }
        }}
        className={cn(
          "h-10 w-10 border text-center tabular-nums outline-none transition-colors focus:border-foreground focus:bg-background sm:w-16",
          n === 0 ? "border-destructive/30 bg-destructive/5 text-destructive" : n <= threshold ? "border-clay/40 bg-clay/5 text-clay" : "border-input bg-card",
          state === "saving" && "opacity-60",
        )}
      />
      {state === "saved" && <Check className="pointer-events-none absolute top-1 right-1 size-3 text-moss" aria-label="Saved" />}
    </span>
  )
}
