import { Heart } from "lucide-react"
import { useWishlist } from "@/context/WishlistContext"
import { cn } from "@/lib/utils"

/** The heart that saves a piece to the wish list. */
export function WishHeart({ product, variant = "card", className }: { product: { id: string; name: string }; variant?: "card" | "button"; className?: string }) {
  const { has, toggle } = useWishlist()
  const saved = has(product.id)
  const label = saved ? `Remove ${product.name} from your wish list` : `Save ${product.name} to your wish list`

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggle(product.id, product.name)
      }}
      aria-label={label}
      aria-pressed={saved}
      title={saved ? "Saved to your wish list" : "Save to your wish list"}
      className={cn(
        "group/heart flex items-center justify-center transition-colors",
        variant === "card"
          ? "size-11 text-foreground"
          : "h-13 w-13 shrink-0 border border-input hover:border-foreground",
        className,
      )}
    >
      <span className={cn("flex items-center justify-center", variant === "card" && "size-9 rounded-full bg-background/85 backdrop-blur-sm group-hover/heart:bg-background")}>
        <Heart
          className={cn("size-[1.15rem] transition-transform group-active/heart:scale-90", saved && "fill-clay text-clay")}
          strokeWidth={1.5}
        />
      </span>
    </button>
  )
}
