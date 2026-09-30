import { useState } from "react"
import { Link } from "react-router-dom"
import { ProductImage } from "@/components/art/ProductImage"
import { WishHeart } from "@/components/WishHeart"
import { Stars } from "@/components/reviews/Stars"
import { isSoldOut, priceRange, type Product } from "@/lib/catalogue"
import { formatPrice } from "@/lib/format"
import { cn } from "@/lib/utils"
import { swatchBackground } from "@/components/art/colour"

export function ProductCard({ product, className }: { product: Product; className?: string }) {
  const [hover, setHover] = useState(false)
  const soldOut = isSoldOut(product)
  const { min, max } = priceRange(product)
  const shownColours = product.colours.slice(0, 5)
  // On hover, show the second photo (or the drawn knit close-up); single-photo products just zoom.
  const hasSecondImage = product.images.length !== 1

  return (
    // The heart sits beside the link (not inside it), so it's its own button.
    <div className={cn("group relative", className)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Link to={`/product/${product.slug}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden bg-muted">
          <ProductImage product={product} className="transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
          {hover && hasSecondImage && (
            <div className="absolute inset-0 animate-in fade-in duration-500">
              <ProductImage product={product} index={1} />
            </div>
          )}
          <div className="absolute top-3 left-3 flex gap-1.5">
            {product.is_new && !soldOut && <Tag>New</Tag>}
            {soldOut && <Tag muted>Sold out</Tag>}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h3 className="font-sans text-[0.95rem] font-medium tracking-normal">{product.name}</h3>
            <p className="mt-1 hidden truncate text-sm text-muted-foreground sm:block">{product.short_description}</p>
          </div>
          <p className="shrink-0 text-[0.95rem] tabular-nums">
            {min !== max && <span className="text-muted-foreground">from </span>}
            {formatPrice(min)}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5" aria-label={`${product.colours.length} colours`}>
            {shownColours.map((c) => (
              <span
                key={c.name}
                title={c.name}
                className="size-3 rounded-full ring-1 ring-black/10 ring-inset"
                style={{ background: swatchBackground(c) }}
              />
            ))}
            {product.colours.length > shownColours.length && (
              <span className="text-xs text-muted-foreground">+{product.colours.length - shownColours.length}</span>
            )}
          </div>
          {product.rating_count > 0 && product.rating_avg != null && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Stars value={Number(product.rating_avg)} size="size-3" />
              <span className="tabular-nums">({product.rating_count})</span>
            </span>
          )}
        </div>
      </Link>
      <WishHeart product={product} className="absolute top-0.5 right-0.5 sm:top-1.5 sm:right-1.5" />
    </div>
  )
}

function Tag({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        "px-2 py-1 text-[0.7rem] font-semibold tracking-[0.12em] uppercase",
        muted ? "bg-background/90 text-muted-foreground" : "bg-foreground text-background",
      )}
    >
      {children}
    </span>
  )
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="aspect-[4/5] animate-pulse bg-muted" />
          <div className="mt-4 h-4 w-2/3 animate-pulse bg-muted" />
          <div className="mt-2 h-3 w-1/2 animate-pulse bg-muted" />
        </div>
      ))}
    </>
  )
}
