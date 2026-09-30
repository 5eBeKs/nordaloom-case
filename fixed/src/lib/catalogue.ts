import { useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"

export type Colour = { name: string; hex: string }

export type Category = {
  slug: string
  name: string
  tagline: string
  description: string
  /** Storage path of the category photo. */
  image: string | null
  sort_order: number
}

export type Variant = {
  id: string
  product_id: string
  colour: string
  size: string
  stock: number
  price_cents: number | null
}

export type Product = {
  id: string
  slug: string
  category_slug: string
  name: string
  short_description: string
  description: string
  materials: string
  care: string[]
  details: string[]
  price_cents: number
  colours: Colour[]
  sizes: string[]
  /** Storage paths (or URLs) of product photos, in display order. */
  images: string[]
  is_featured: boolean
  is_new: boolean
  sort_order: number
  created_at: string
  /** Average of published reviews (null until the first one). */
  rating_avg: number | null
  rating_count: number
  product_variants: Variant[]
}

const PRODUCT_FIELDS = "*, product_variants(*)"

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("sort_order")
      if (error) throw error
      return data as Category[]
    },
    staleTime: 5 * 60_000,
  })
}

export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_FIELDS)
        .order("sort_order")
      if (error) throw error
      return data as Product[]
    },
    staleTime: 60_000,
  })
}

export function useProduct(slug: string | undefined) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ["product", slug],
    enabled: !!slug,
    // Straight from the catalogue list if it's there (also offline), then checked with the shop.
    initialData: () => qc.getQueryData<Product[]>(["products"])?.find((p) => p.slug === slug),
    initialDataUpdatedAt: () => qc.getQueryState(["products"])?.dataUpdatedAt,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_FIELDS)
        .eq("slug", slug!)
        .maybeSingle()
      if (error) throw error
      return data as Product | null
    },
    staleTime: 60_000,
  })
}

export function isSoldOut(p: Product) {
  return p.product_variants.every((v) => v.stock <= 0)
}

/** Lowest and highest variant price, for products with size-dependent prices. */
export function priceRange(p: Product) {
  const prices = p.product_variants.map((v) => v.price_cents ?? p.price_cents)
  if (prices.length === 0) return { min: p.price_cents, max: p.price_cents }
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

export function variantPrice(p: Pick<Product, "price_cents">, v: Pick<Variant, "price_cents">) {
  return v.price_cents ?? p.price_cents
}
