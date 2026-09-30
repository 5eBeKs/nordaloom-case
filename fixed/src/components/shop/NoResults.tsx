import { Link } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductCard } from "@/components/ProductCard"
import type { Product } from "@/lib/catalogue"
import { SEARCH_SUGGESTIONS } from "@/lib/search"

type Suggestion = { label: string; count: number; onClick: () => void }

/**
 * Shown instead of an empty grid: says what happened, offers the quickest
 * ways out, and shows a few pieces so the page is never bare.
 */
export function NoResults({
  query,
  filterSuggestions,
  wordSuggestions,
  onClearFilters,
  hasFilters,
  fallback,
}: {
  query?: string
  filterSuggestions: Suggestion[]
  wordSuggestions: { word: string; count: number }[]
  onClearFilters: () => void
  hasFilters: boolean
  fallback: Product[]
}) {
  return (
    <div className="py-14 md:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-serif text-3xl font-light md:text-4xl">
          {query && !hasFilters ? <>We couldn't find “{query}”.</> : "Nothing matches all of that — yet."}
        </p>
        <p className="mt-4 text-muted-foreground">
          {query && !hasFilters
            ? "Try a simpler word, a colour or a material — or have a look at the pieces below."
            : "Small batches sell out quickly. Loosen one of the filters, or have a look at the pieces below."}
        </p>

        {filterSuggestions.length > 0 && (
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {filterSuggestions.map((s) => (
              <button key={s.label} type="button" onClick={s.onClick} className="flex items-center gap-2 border border-input bg-card px-4 py-2 text-sm hover:border-foreground">
                {s.label}
                <span className="text-muted-foreground">
                  · {s.count} {s.count === 1 ? "piece" : "pieces"}
                </span>
              </button>
            ))}
          </div>
        )}

        {wordSuggestions.length > 0 && (
          <p className="mt-6 text-sm">
            Try just{" "}
            {wordSuggestions.map((w, i) => (
              <span key={w.word}>
                {i > 0 && " or "}
                <Link to={`/search?q=${encodeURIComponent(w.word)}`} className="underline underline-offset-4">
                  {w.word}
                </Link>
                <span className="text-muted-foreground"> ({w.count})</span>
              </span>
            ))}
          </p>
        )}

        {query && !hasFilters && wordSuggestions.length === 0 && (
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {SEARCH_SUGGESTIONS.map((s) => (
              <Link key={s} to={`/search?q=${encodeURIComponent(s.toLowerCase())}`} className="bg-sand px-4 py-2.5 text-sm hover:bg-accent">
                {s}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {hasFilters && (
            <Button onClick={onClearFilters} className="h-11 rounded-none px-6">
              Clear all filters
            </Button>
          )}
          <Button asChild variant="outline" className="h-11 rounded-none bg-transparent px-6">
            <Link to="/shop">
              Browse everything <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      {fallback.length > 0 && (
        <section className="mt-20">
          <h2 className="text-center text-2xl md:text-3xl">Perhaps one of these</h2>
          <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-12 md:grid-cols-4 md:gap-x-6">
            {fallback.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
