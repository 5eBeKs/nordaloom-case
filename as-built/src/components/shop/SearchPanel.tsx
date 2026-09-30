import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowRight, Search } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { ProductImage } from "@/components/art/ProductImage"
import { isSoldOut, priceRange, useCategories, useProducts } from "@/lib/catalogue"
import { formatPrice } from "@/lib/format"
import { indexProducts, searchProducts, SEARCH_SUGGESTIONS } from "@/lib/search"

const SHOWN = 6

/** The header search: results appear as you type; Enter opens the full results page. */
export function SearchPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { data: products = [] } = useProducts()
  const { data: categories = [] } = useCategories()
  const [query, setQuery] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const index = useMemo(() => indexProducts(products, categories), [products, categories])
  const results = useMemo(() => searchProducts(index, query), [index, query])
  const catName = new Map(categories.map((c) => [c.slug, c.name]))
  const q = query.trim()

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50)
  }, [open])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!q) return
    onOpenChange(false)
    navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  const close = () => onOpenChange(false)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="top" className="max-h-[90svh] gap-0 overflow-y-auto bg-background p-0">
        <SheetTitle className="sr-only">Search the shop</SheetTitle>
        <SheetDescription className="sr-only">Find pieces by name, colour or material.</SheetDescription>
        <div className="container-shop py-6 md:py-10">
          <form onSubmit={submit} role="search" className="flex items-center gap-3 border-b border-foreground/40 pb-3 focus-within:border-foreground">
            <Search className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, colour or material"
              aria-label="Search the shop"
              className="h-12 flex-1 bg-transparent font-serif text-2xl font-light outline-none placeholder:text-muted-foreground/60 md:text-3xl"
            />
          </form>

          {!q ? (
            <div className="mt-6">
              <p className="eyebrow">Try</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SEARCH_SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => setQuery(s)} className="bg-sand px-3.5 py-1.5 text-sm hover:bg-accent">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="mt-8">
              <p className="text-lg">Nothing matches “{q}”.</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a simpler word — a colour like “green”, a material like “merino”, or a kind of piece.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {SEARCH_SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => setQuery(s)} className="bg-sand px-3.5 py-1.5 text-sm hover:bg-accent">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <ul className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
                {results.slice(0, SHOWN).map((p) => {
                  const { min, max } = priceRange(p)
                  return (
                    <li key={p.id}>
                      <Link to={`/product/${p.slug}`} onClick={close} className="flex items-center gap-4 p-2 transition-colors hover:bg-sand/60">
                        <span className="block aspect-[4/5] w-14 shrink-0 overflow-hidden bg-muted">
                          <ProductImage product={p} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block truncate text-sm text-muted-foreground">
                            {catName.get(p.category_slug)} · {p.colours.map((c) => c.name).slice(0, 3).join(", ")}
                            {p.colours.length > 3 && "…"}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-sm tabular-nums">
                          {min !== max && <span className="text-muted-foreground">from </span>}
                          {formatPrice(min)}
                          {isSoldOut(p) && <span className="block text-xs text-muted-foreground">Sold out</span>}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
              <Link
                to={`/search?q=${encodeURIComponent(q)}`}
                onClick={close}
                className="mt-6 inline-flex items-center gap-2 text-sm underline underline-offset-4"
              >
                {results.length > SHOWN ? `See all ${results.length} pieces` : "See them with filters"} <ArrowRight className="size-4" />
              </Link>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
