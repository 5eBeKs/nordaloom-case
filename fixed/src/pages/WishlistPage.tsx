import { Link } from "react-router-dom"
import { Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductCard, ProductGridSkeleton } from "@/components/ProductCard"
import { useAuth } from "@/context/AuthContext"
import { useWishlist } from "@/context/WishlistContext"
import { isSoldOut, useProducts, type Product } from "@/lib/catalogue"
import { useTitle } from "@/hooks/use-title"

export function WishlistPage() {
  useTitle("Wish list")
  const { user } = useAuth()
  const { ids, ready } = useWishlist()
  const { data: products, isLoading } = useProducts()

  const byId = new Map((products ?? []).map((p) => [p.id, p]))
  // Pieces the shop has since taken down simply aren't shown.
  const saved = ids.flatMap((id) => byId.get(id) ?? [])
  const soldOut = saved.filter(isSoldOut).length
  const loading = !ready || isLoading

  return (
    <div className="container-shop pt-14 md:pt-20">
      <p className="eyebrow">Saved for later</p>
      <h1 className="mt-4 text-5xl font-light md:text-6xl">Wish list</h1>
      {!loading && saved.length > 0 && (
        <p className="mt-4 text-muted-foreground">
          {saved.length} {saved.length === 1 ? "piece" : "pieces"}
          {soldOut > 0 && <> · {soldOut} sold out for now</>}
        </p>
      )}
      {!user && (
        <p className="mt-6 max-w-2xl border bg-card p-4 text-sm text-muted-foreground">
          Your list is kept in this browser.{" "}
          <Link to="/login?next=%2Fwishlist" className="text-foreground underline underline-offset-4">
            Sign in
          </Link>{" "}
          or{" "}
          <Link to="/register" className="text-foreground underline underline-offset-4">
            create an account
          </Link>{" "}
          to keep it on every device.
        </p>
      )}

      {loading ? (
        <div className="mt-12 grid grid-cols-2 gap-x-4 gap-y-12 lg:grid-cols-4 lg:gap-x-6">
          <ProductGridSkeleton count={4} />
        </div>
      ) : saved.length > 0 ? (
        <div className="mt-12 grid grid-cols-2 gap-x-4 gap-y-12 lg:grid-cols-4 lg:gap-x-6">
          {saved.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <Empty picks={(products ?? []).filter((p) => p.is_featured && !isSoldOut(p)).slice(0, 4)} />
      )}
    </div>
  )
}

function Empty({ picks }: { picks: Product[] }) {
  return (
    <div className="mt-12">
      <div className="max-w-lg">
        <Heart className="size-7 text-clay" strokeWidth={1.25} />
        <p className="mt-5 font-serif text-3xl font-light">Nothing saved yet.</p>
        <p className="mt-3 text-muted-foreground">Tap the heart on any piece to keep it here while you think it over.</p>
        <Button asChild size="lg" className="mt-8 h-12 rounded-none px-8">
          <Link to="/shop">Browse the shop</Link>
        </Button>
      </div>
      {picks.length > 0 && (
        <section className="mt-20">
          <h2 className="text-2xl md:text-3xl">A few to start with</h2>
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-12 lg:grid-cols-4 lg:gap-x-6">
            {picks.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
