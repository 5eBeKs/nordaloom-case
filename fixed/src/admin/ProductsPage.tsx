import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ProductImage } from "@/components/art/ProductImage"
import { swatchBackground } from "@/components/art/colour"
import { setPublished, useAdminProducts, type AdminProduct } from "@/lib/admin"
import { useCategories } from "@/lib/catalogue"
import { DEMO_CATALOGUE_OFF, demoRefused } from "@/lib/demo"
import { formatPrice } from "@/lib/format"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { Empty, FilterTabs, PageHeader, SearchInput, Toggle } from "./ui"

type Visibility = "all" | "shown" | "hidden"

export function ProductsPage() {
  useTitle("Products")
  const { data: products = [], isLoading } = useAdminProducts()
  const { data: categories = [] } = useCategories()
  const [category, setCategory] = useState("all")
  const [visibility, setVisibility] = useState<Visibility>("all")
  const [search, setSearch] = useState("")

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const order = new Map(categories.map((c) => [c.slug, c.sort_order]))
    return products
      .filter(
        (p) =>
          (category === "all" || p.category_slug === category) &&
          (visibility === "all" || (visibility === "shown" ? p.is_published : !p.is_published)) &&
          (!q || p.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => (order.get(a.category_slug) ?? 99) - (order.get(b.category_slug) ?? 99) || a.sort_order - b.sort_order)
  }, [products, categories, category, visibility, search])

  const counts = {
    all: products.length,
    shown: products.filter((p) => p.is_published).length,
    hidden: products.filter((p) => !p.is_published).length,
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Products"
        intro="Everything in the shop, including hidden pieces. Hidden products stay here but don't appear in the shop."
        actions={
          <Button asChild className="h-11 rounded-none px-6">
            <Link to="/admin/products/new">
              <Plus className="size-4" /> Add a product
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name" className="w-full max-w-xs" />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-11 border border-input bg-card px-3 text-sm"
          aria-label="Category"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <FilterTabs
          options={[
            { key: "all" as const, label: "All" },
            { key: "shown" as const, label: "In the shop" },
            { key: "hidden" as const, label: "Hidden" },
          ]}
          value={visibility}
          onChange={setVisibility}
          counts={counts}
        />
        {isLoading ? (
          <Empty>Loading products…</Empty>
        ) : shown.length === 0 ? (
          <Empty>No products match.</Empty>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => (
              <ProductTile key={p.id} product={p} categoryName={categories.find((c) => c.slug === p.category_slug)?.name ?? p.category_slug} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProductTile({ product: p, categoryName }: { product: AdminProduct; categoryName: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const stock = p.product_variants.reduce((n, v) => n + v.stock, 0)
  const soldOut = p.product_variants.filter((v) => v.stock === 0).length

  async function toggle(next: boolean) {
    setBusy(true)
    try {
      await setPublished(p.id, next)
      toast.success(next ? `${p.name} is now in the shop.` : `${p.name} is hidden.`)
      for (const key of ["admin-products", "products", "product", "admin-dashboard"]) void queryClient.invalidateQueries({ queryKey: [key] })
    } catch (e) {
      toast.error(demoRefused(e) ? DEMO_CATALOGUE_OFF : "That didn't work — please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="group">
      <Link to={`/admin/products/${p.id}`} className="relative block aspect-[4/5] overflow-hidden bg-muted">
        {/* Hidden pieces: the photo is faded, the words stay readable. */}
        <ProductImage product={p} className={cn("transition-transform duration-500 group-hover:scale-[1.03]", !p.is_published && "opacity-50")} />
        {!p.is_published && (
          <span className="absolute top-3 left-3 bg-background/90 px-2 py-1 text-[0.7rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Hidden
          </span>
        )}
        {p.images.length === 0 && (
          <span className="absolute right-3 bottom-3 left-3 bg-background/90 px-2 py-1 text-center text-xs text-clay">No photo yet</span>
        )}
      </Link>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/admin/products/${p.id}`} className="block truncate font-medium hover:underline">
            {p.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {categoryName} · {formatPrice(p.price_cents)}
          </p>
        </div>
        <Toggle checked={p.is_published} onChange={toggle} disabled={busy} label={p.is_published ? `Hide ${p.name}` : `Show ${p.name}`} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex gap-1">
          {p.colours.slice(0, 6).map((c) => (
            <span key={c.name} title={c.name} className="size-3 rounded-full ring-1 ring-black/10 ring-inset" style={{ background: swatchBackground(c) }} />
          ))}
        </span>
        <span className={cn(stock === 0 && "text-destructive")}>
          {stock} in stock{soldOut > 0 && stock > 0 && <> · {soldOut} sold out</>}
        </span>
      </div>
    </div>
  )
}
