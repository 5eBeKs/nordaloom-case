import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Search } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ProductCard, ProductGridSkeleton } from "@/components/ProductCard"
import { ActiveFilterChips, activeFilters, applyFilters, FilterBar, FilterSheetButton, useFilterOptions, useFilters } from "@/components/shop/filters"
import { NoResults } from "@/components/shop/NoResults"
import { isSoldOut, priceRange, useCategories, useProducts, type Product } from "@/lib/catalogue"
import { indexProducts, normalize, searchProducts, SEARCH_SUGGESTIONS } from "@/lib/search"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { NotFoundPage } from "./NotFoundPage"

const SORTS = {
  featured: { label: "Featured", fn: (a: Product, b: Product) => Number(b.is_featured) - Number(a.is_featured) },
  new: { label: "Newest", fn: (a: Product, b: Product) => Number(b.is_new) - Number(a.is_new) },
  "price-asc": { label: "Price, low to high", fn: (a: Product, b: Product) => priceRange(a).min - priceRange(b).min },
  "price-desc": { label: "Price, high to low", fn: (a: Product, b: Product) => priceRange(b).min - priceRange(a).min },
} as const
type SortKey = keyof typeof SORTS

export function ShopPage({ mode = "browse" }: { mode?: "browse" | "search" }) {
  const searching = mode === "search"
  const { category: slug } = useParams()
  const [params, setParams] = useSearchParams()
  const { data: categories, isLoading: loadingCategories } = useCategories()
  const { data: products, isLoading, error } = useProducts()
  const category = searching ? undefined : categories?.find((c) => c.slug === slug)
  const query = searching ? (params.get("q") ?? "").trim() : ""
  useTitle(searching ? (query ? `Search: ${query}` : "Search") : category?.name ?? "Shop")

  const { filters, update, clear, count: activeCount } = useFilters()
  const sort: SortKey = (params.get("sort") as SortKey) in SORTS ? (params.get("sort") as SortKey) : "featured"
  const categoryOrder = useMemo(() => new Map(categories?.map((c) => [c.slug, c.sort_order])), [categories])
  const index = useMemo(() => indexProducts(products ?? [], categories ?? []), [products, categories])

  // The pieces this page is about, before filters: a category, everything, or search results.
  const scope = useMemo(() => {
    if (searching) return query ? searchProducts(index, query) : []
    return (products ?? []).filter((p) => !slug || p.category_slug === slug)
  }, [searching, query, index, products, slug])

  const list = useMemo(() => {
    const filtered = applyFilters(scope, filters)
    // Search keeps its best-match order unless another sort is chosen.
    if (searching && sort === "featured") return [...filtered].sort((a, b) => Number(isSoldOut(a)) - Number(isSoldOut(b)))
    return [...filtered].sort(
      (a, b) =>
        Number(isSoldOut(a)) - Number(isSoldOut(b)) ||
        SORTS[sort].fn(a, b) ||
        (categoryOrder.get(a.category_slug) ?? 0) - (categoryOrder.get(b.category_slug) ?? 0) ||
        a.sort_order - b.sort_order,
    )
  }, [scope, filters, sort, searching, categoryOrder])

  const options = useFilterOptions(scope, filters)

  if (!searching && slug && !loadingCategories && categories && !category) return <NotFoundPage />

  // Filters and sorting carry over when switching category.
  const keep = params.toString() ? `?${params.toString()}` : ""
  const featured = (products ?? []).filter((p) => p.is_featured && !isSoldOut(p)).slice(0, 4)
  const setSort = (v: string) => {
    const next = new URLSearchParams(params)
    if (v === "featured") next.delete("sort")
    else next.set("sort", v)
    setParams(next, { replace: true })
  }

  // Ways out of an empty result: drop one filter, or search for one word.
  const filterSuggestions = activeFilters(filters, update)
    .map((chip) => {
      const without = { ...filters }
      if (chip.key.startsWith("s-")) without.sizes = filters.sizes.filter((s) => `s-${s}` !== chip.key)
      else if (chip.key.startsWith("c-")) without.colours = filters.colours.filter((c) => `c-${c}` !== chip.key)
      else if (chip.key === "price") without.price = null
      else if (chip.key === "stock") without.inStock = false
      return { label: `Without “${chip.label}”`, count: applyFilters(scope, without).length, onClick: chip.remove }
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
  const words = normalize(query).split(/\s+/).filter((w) => w.length > 2)
  const wordSuggestions =
    searching && scope.length === 0 && words.length > 1
      ? words.map((w) => ({ word: w, count: searchProducts(index, w).length })).filter((w) => w.count > 0)
      : []
  const fallback = scope.length > 0 ? scope.filter((p) => !isSoldOut(p)).slice(0, 4) : featured

  return (
    <div className="container-shop">
      {searching ? (
        <SearchHeader query={query} total={isLoading ? null : list.length} />
      ) : (
        <header className="pt-14 pb-10 md:pt-20 md:pb-14">
          <p className="eyebrow">{category ? "Shop" : "Nordaloom"}</p>
          <h1 className="mt-4 text-5xl font-light md:text-6xl">{category?.name ?? "All knitwear"}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {category?.description ??
              "Everything we make, from everyday crewnecks to heavy blankets for long evenings. All knitted in small batches in Latvia."}
          </p>
        </header>
      )}

      {(!searching || scope.length > 0) && (
        <div className="sticky top-16 z-30 -mx-5 border-y bg-background/95 px-5 py-3 backdrop-blur md:top-20 md:-mx-10 md:px-10">
          {!searching && (
            <nav className="-mx-1 mb-3 flex gap-1 overflow-x-auto border-b pb-3" aria-label="Categories">
              <Chip to={`/shop${keep}`} active={!slug}>
                All
              </Chip>
              {categories?.map((c) => (
                <Chip key={c.slug} to={`/shop/${c.slug}${keep}`} active={c.slug === slug}>
                  {c.name}
                </Chip>
              ))}
            </nav>
          )}
          <div className="flex items-center justify-between gap-3">
            <FilterBar options={options} f={filters} update={update} />
            <FilterSheetButton options={options} f={filters} update={update} clear={clear} active={activeCount} resultCount={list.length} />
            <div className="flex items-center gap-4">
              <p className="hidden text-sm text-muted-foreground sm:block">
                {isLoading ? "…" : `${list.length} ${list.length === 1 ? "piece" : "pieces"}`}
              </p>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="h-11 w-44 rounded-none border-input bg-transparent shadow-none sm:w-48" aria-label="Sort by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {Object.entries(SORTS).map(([key, s]) => (
                    <SelectItem key={key} value={key}>
                      {searching && key === "featured" ? "Best match" : s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5">
        <ActiveFilterChips f={filters} update={update} clear={clear} />
      </div>

      {error ? (
        <p className="py-24 text-center text-muted-foreground">We couldn't load the shop just now. Please refresh the page.</p>
      ) : isLoading ? (
        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-12 md:grid-cols-3 md:gap-x-6 md:gap-y-16">
          <ProductGridSkeleton count={9} />
        </div>
      ) : searching && !query ? (
        <section className="mt-6">
          <h2 className="text-2xl md:text-3xl">Popular right now</h2>
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-12 md:grid-cols-4 md:gap-x-6">
            {featured.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : list.length === 0 ? (
        <NoResults
          query={searching ? query : undefined}
          hasFilters={activeCount > 0 && scope.length > 0}
          filterSuggestions={filterSuggestions}
          wordSuggestions={wordSuggestions}
          onClearFilters={clear}
          fallback={fallback}
        />
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-12 md:grid-cols-3 md:gap-x-6 md:gap-y-16">
          {list.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  )
}

function SearchHeader({ query, total }: { query: string; total: number | null }) {
  const navigate = useNavigate()
  const [value, setValue] = useState(query)
  useEffect(() => setValue(query), [query])

  function submit(e: FormEvent) {
    e.preventDefault()
    const q = value.trim()
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { replace: true })
  }

  return (
    <header className="pt-14 pb-10 md:pt-20 md:pb-12">
      <p className="eyebrow">Search</p>
      <h1 className="mt-4 text-5xl font-light md:text-6xl">{query ? <>“{query}”</> : "Find a piece"}</h1>
      {query && total !== null && (
        <p className="mt-3 text-muted-foreground">
          {total} {total === 1 ? "piece" : "pieces"}
        </p>
      )}
      <form onSubmit={submit} role="search" className="mt-8 flex max-w-xl border-b border-foreground/40 focus-within:border-foreground">
        <Search className="my-auto size-5 text-muted-foreground" strokeWidth={1.5} />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search by name, colour or material"
          aria-label="Search the shop"
          className="h-12 flex-1 bg-transparent px-3 text-lg outline-none placeholder:text-muted-foreground/70"
        />
      </form>
      {!query && (
        <div className="mt-6 flex flex-wrap gap-2">
          {SEARCH_SUGGESTIONS.map((s) => (
            <Link key={s} to={`/search?q=${encodeURIComponent(s.toLowerCase())}`} className="bg-sand px-3.5 py-1.5 text-sm hover:bg-accent">
              {s}
            </Link>
          ))}
        </div>
      )}
    </header>
  )
}

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 shrink-0 items-center px-3.5 text-sm whitespace-nowrap transition-colors",
        active ? "bg-foreground text-background" : "text-foreground/75 hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  )
}
