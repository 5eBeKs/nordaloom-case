import { Link } from "react-router-dom"
import { Minus, Plus } from "lucide-react"
import { ProductImage } from "@/components/art/ProductImage"
import { MAX_QTY, useCart, type CartItem } from "@/context/CartContext"
import { formatPrice } from "@/lib/format"
import { cn } from "@/lib/utils"

export function CartLine({ item, onNavigate, large = false }: { item: CartItem; onNavigate?: () => void; large?: boolean }) {
  const { setQuantity, remove } = useCart()
  const colour = item.product.colours.find((c) => c.name === item.colour)
  const max = Math.min(MAX_QTY, item.stock)
  const href = `/product/${item.product.slug}?colour=${encodeURIComponent(item.colour)}`

  return (
    <li className={cn("flex gap-4 py-5", large && "gap-6 py-7")}>
      <Link
        to={href}
        onClick={onNavigate}
        className={cn("block aspect-[4/5] shrink-0 overflow-hidden bg-muted", large ? "w-28 sm:w-36" : "w-20")}
      >
        <ProductImage product={item.product} colour={colour} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={href} onClick={onNavigate} className={cn("font-medium hover:underline", large && "font-serif text-lg")}>
              {item.product.name}
            </Link>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.colour}
              {item.size !== "One size" && <> · {item.size}</>}
            </p>
          </div>
          <p className="shrink-0 text-sm font-medium tabular-nums">{formatPrice(item.lineTotal)}</p>
        </div>
        {item.stock <= 0 ? (
          <p className="mt-2 text-sm text-destructive">This piece has just sold out.</p>
        ) : item.quantity > item.stock ? (
          <p className="mt-2 text-sm text-destructive">Only {item.stock} left — please reduce the quantity.</p>
        ) : null}
        <div className="mt-auto flex items-center justify-between pt-3">
          <div className="flex items-center border border-input">
            <button
              className="flex size-8 items-center justify-center text-foreground/70 hover:text-foreground disabled:opacity-30"
              onClick={() => setQuantity(item.variantId, item.quantity - 1)}
              disabled={item.quantity <= 1}
              aria-label="Decrease quantity"
            >
              <Minus className="size-3.5" />
            </button>
            <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
              {item.quantity}
            </span>
            <button
              className="flex size-8 items-center justify-center text-foreground/70 hover:text-foreground disabled:opacity-30"
              onClick={() => setQuantity(item.variantId, item.quantity + 1)}
              disabled={item.quantity >= max}
              aria-label="Increase quantity"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <button onClick={() => remove(item.variantId)} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Remove
          </button>
        </div>
      </div>
    </li>
  )
}
