import { cn } from "@/lib/utils"
import type { Colour } from "@/lib/catalogue"
import { imageUrl } from "@/lib/images"
import { ProductArt, type ArtView } from "./ProductArt"

type Props = {
  product: { slug: string; category_slug: string; name: string; images: string[]; colours: Colour[] }
  colour?: Colour
  /** Position in the gallery. */
  index?: number
  className?: string
  eager?: boolean
}

const VIEWS: ArtView[] = ["garment", "texture", "detail"]

/** A product photo, or a drawn stand-in for products that have no photo yet. */
export function ProductImage({ product, colour, index = 0, className, eager }: Props) {
  if (product.images.length > 0) {
    const photo = product.images[index] ?? product.images[0]
    return (
      <img
        src={imageUrl(photo)}
        alt={product.name}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={cn("h-full w-full object-cover", className)}
      />
    )
  }
  const c = colour ?? product.colours[0] ?? { name: "Oat", hex: "#d9ccb4" }
  return (
    <ProductArt
      category={product.category_slug}
      slug={product.slug}
      colour={c}
      view={VIEWS[index % VIEWS.length]}
      className={className}
      title={`${product.name} in ${c.name}`}
    />
  )
}

/** Number of images in a product's gallery (its photos, or the drawn views). */
export function galleryCount(product: { images: string[] }) {
  return product.images.length || VIEWS.length
}

/** A photo from the product-images bucket used on content pages. */
export function SitePhoto({ path, alt, className, eager }: { path: string; alt: string; className?: string; eager?: boolean }) {
  return (
    <img
      src={imageUrl(path)}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={cn("h-full w-full object-cover", className)}
    />
  )
}
