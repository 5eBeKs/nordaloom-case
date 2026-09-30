import { useEffect, useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Leaf, Ruler, Scissors } from "lucide-react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { ProductImage, galleryCount } from "@/components/art/ProductImage"
import { ProductCard } from "@/components/ProductCard"
import { WishHeart } from "@/components/WishHeart"
import { ProductReviews } from "@/components/reviews/ProductReviews"
import { Stars } from "@/components/reviews/Stars"
import { SizeGuideLink } from "@/components/shop/SizeGuide"
import { useCart } from "@/context/CartContext"
import { useCategories, useProduct, useProducts, variantPrice } from "@/lib/catalogue"
import { formatPrice } from "@/lib/format"
import { useTitle } from "@/hooks/use-title"
import { cn } from "@/lib/utils"
import { swatchBackground } from "@/components/art/colour"
import { NotFoundPage } from "./NotFoundPage"
import { useOnline } from "@/lib/pwa"

const LOW_STOCK = 3

export function ProductPage() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const { data: product, isLoading } = useProduct(slug)
  const { data: categories } = useCategories()
  const { data: all } = useProducts()
  const { add, setOpen } = useCart()
  const online = useOnline()
  useTitle(product?.name)

  const colourParam = params.get("colour")
  const colour = product?.colours.find((c) => c.name === colourParam) ?? product?.colours[0]
  const [size, setSize] = useState<string | null>(null)
  const [image, setImage] = useState(0)

  // Reset choices when moving to another product.
  useEffect(() => {
    setSize(null)
    setImage(0)
  }, [slug])

  const variants = useMemo(() => {
    const m = new Map<string, NonNullable<typeof product>["product_variants"][number]>()
    product?.product_variants.forEach((v) => m.set(`${v.colour}|${v.size}`, v))
    return m
  }, [product])

  const oneSize = product?.sizes.length === 1
  const chosenSize = oneSize ? product!.sizes[0] : size
  const variant = colour && chosenSize ? variants.get(`${colour.name}|${chosenSize}`) : undefined
  const stockFor = (s: string) => (colour ? variants.get(`${colour.name}|${s}`)?.stock ?? 0 : 0)
  const colourSoldOut = !!product && product.sizes.every((s) => stockFor(s) <= 0)

  if (isLoading && !online) return <NotSavedOffline />
  if (isLoading) return <ProductSkeleton />
  if (!product || !colour) return <NotFoundPage />

  const category = categories?.find((c) => c.slug === product.category_slug)
  const price = variant ? variantPrice(product, variant) : product.price_cents
  const related = (all ?? []).filter((p) => p.category_slug === product.category_slug && p.id !== product.id).slice(0, 4)
  const images = galleryCount(product)
  const madeIn = product.details.find((d) => /in Latvia$/.test(d)) ?? "Made in small batches in Latvia"

  const sizeGuide = (
    <SizeGuideLink
      categorySlug={product.category_slug}
      productName={product.name}
      fitNote={product.details.find((d) => /\bfit\b|size (up|down)/i.test(d))}
      size={chosenSize}
    />
  )

  function chooseColour(name: string) {
    const next = new URLSearchParams(params)
    next.set("colour", name)
    setParams(next, { replace: true })
    if (size && (variants.get(`${name}|${size}`)?.stock ?? 0) <= 0) setSize(null)
  }

  function addToBag() {
    if (!product || !colour) return
    if (!chosenSize) {
      toast("Please choose a size first.")
      return
    }
    if (!variant || variant.stock <= 0) return
    add(variant.id, 1, variant.stock)
    setOpen(true)
  }

  let buttonLabel = "Add to bag"
  if (colourSoldOut) buttonLabel = "Sold out in this colour"
  else if (!chosenSize) buttonLabel = "Select a size"
  else if (variant && variant.stock <= 0) buttonLabel = "Sold out in this size"

  return (
    <div className="container-shop">
      <nav className="flex flex-wrap items-center gap-x-2 pt-4 pb-4 text-xs text-muted-foreground md:pt-6" aria-label="Breadcrumb">
        <Link to="/shop" className="py-2 hover:text-foreground">
          Shop
        </Link>
        <span>/</span>
        {category && (
          <>
            <Link to={`/shop/${category.slug}`} className="py-2 hover:text-foreground">
              {category.name}
            </Link>
            <span>/</span>
          </>
        )}
        <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        {/* Gallery */}
        <div className="lg:col-span-7">
          <div className={cn("grid gap-3 md:gap-4", images > 1 && "md:grid-cols-[5rem_1fr]")}>
            <div className={cn("order-2 flex gap-3 md:order-1 md:flex-col", images < 2 && "hidden")}>
              {Array.from({ length: images }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setImage(i)}
                  className={cn(
                    "aspect-[4/5] w-16 overflow-hidden bg-muted ring-offset-2 ring-offset-background transition md:w-full",
                    image === i ? "ring-1 ring-foreground" : "opacity-70 hover:opacity-100",
                  )}
                  aria-label={`Show image ${i + 1}`}
                  aria-pressed={image === i}
                >
                  <ProductImage product={product} colour={colour} index={i} />
                </button>
              ))}
            </div>
            {/* Photos keep their own proportions; drawings use the standard 4:5 frame. */}
            <div className={cn("order-1 overflow-hidden bg-muted md:order-2", product.images.length === 0 && "aspect-[4/5]")}>
              <ProductImage
                key={`${colour.name}-${image}`}
                product={product}
                colour={colour}
                index={image}
                eager
                className={cn("animate-in fade-in duration-500", product.images.length > 0 && "h-auto max-h-[85svh]")}
              />
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            {product.is_new && <p className="eyebrow mb-3 text-clay">New this season</p>}
            <h1 className="text-4xl leading-tight font-light md:text-5xl">{product.name}</h1>
            <p className="mt-4 flex items-baseline gap-3">
              <span className="text-2xl tabular-nums">{formatPrice(price)}</span>
              <span className="text-sm text-muted-foreground">incl. VAT</span>
            </p>
            {product.rating_count > 0 && product.rating_avg != null && (
              <a href="#reviews" className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <Stars value={Number(product.rating_avg)} />
                <span className="underline-offset-4 hover:underline">
                  {Number(product.rating_avg).toFixed(1)} · {product.rating_count} {product.rating_count === 1 ? "review" : "reviews"}
                </span>
              </a>
            )}
            <p className="mt-6 leading-relaxed text-muted-foreground">{product.short_description}.</p>

            {/* Colour */}
            <fieldset className="mt-9">
              <legend className="text-sm">
                Colour: <span className="text-muted-foreground">{colour.name}</span>
              </legend>
              <div className="mt-3 flex flex-wrap gap-3">
                {product.colours.map((c) => {
                  const soldOut = product.sizes.every((s) => (variants.get(`${c.name}|${s}`)?.stock ?? 0) <= 0)
                  return (
                    <button
                      key={c.name}
                      onClick={() => chooseColour(c.name)}
                      title={soldOut ? `${c.name} (sold out)` : c.name}
                      aria-label={soldOut ? `${c.name}, sold out` : c.name}
                      aria-pressed={c.name === colour.name}
                      className={cn(
                        "relative size-10 rounded-full ring-offset-2 ring-offset-background transition",
                        c.name === colour.name ? "ring-1 ring-foreground" : "hover:ring-1 hover:ring-foreground/30",
                      )}
                    >
                      <span className="absolute inset-0 rounded-full ring-1 ring-black/10 ring-inset" style={{ background: swatchBackground(c) }} />
                      {soldOut && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="h-px w-10 rotate-45 bg-foreground/60" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {/* Size */}
            {!oneSize ? (
              <fieldset className="mt-8">
                <div className="flex items-baseline justify-between gap-4">
                  <legend className="text-sm">
                    Size{chosenSize && <span className="text-muted-foreground">: {chosenSize}</span>}
                  </legend>
                  {sizeGuide}
                </div>
                <div className={cn("mt-3 grid gap-2", product.category_slug === "blankets" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-5")}>
                  {product.sizes.map((s) => {
                    const stock = stockFor(s)
                    const override = colour && variants.get(`${colour.name}|${s}`)?.price_cents
                    return (
                      <button
                        key={s}
                        onClick={() => setSize(s)}
                        disabled={stock <= 0}
                        aria-pressed={size === s}
                        className={cn(
                          "h-11 border px-2 text-sm transition-colors",
                          size === s ? "border-foreground bg-foreground text-background" : "border-input hover:border-foreground",
                          stock <= 0 && "cursor-not-allowed text-muted-foreground line-through opacity-50 hover:border-input",
                        )}
                      >
                        {s}
                        {override ? <span className="ml-1.5 opacity-70">· {formatPrice(override)}</span> : null}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            ) : (
              <div className="mt-8 flex items-baseline justify-between gap-4">
                <p className="text-sm">
                  Size: <span className="text-muted-foreground">One size</span>
                </p>
                {sizeGuide}
              </div>
            )}

            <p className="mt-4 min-h-5 text-sm" aria-live="polite">
              {variant && variant.stock > 0 && variant.stock <= LOW_STOCK && (
                <span className="text-clay">Only {variant.stock} left in this batch</span>
              )}
              {variant && variant.stock > LOW_STOCK && <span className="text-moss">In stock, ready to ship</span>}
            </p>

            <div className="mt-3 flex gap-2">
              <Button
                size="lg"
                onClick={addToBag}
                disabled={colourSoldOut || (!!variant && variant.stock <= 0)}
                className="h-13 flex-1 rounded-none text-[0.8rem] tracking-[0.12em] uppercase"
              >
                {buttonLabel}
              </Button>
              <WishHeart product={product} variant="button" />
            </div>

            <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <Scissors className="size-4 shrink-0 translate-y-0.5" strokeWidth={1.5} /> {madeIn}
              </li>
              <li className="flex gap-3">
                <Leaf className="size-4 shrink-0 translate-y-0.5" strokeWidth={1.5} /> {product.materials}
              </li>
              {product.details[0] && (
                <li className="flex gap-3">
                  <Ruler className="size-4 shrink-0 translate-y-0.5" strokeWidth={1.5} /> {product.details[0]}
                </li>
              )}
            </ul>

            <Accordion type="multiple" defaultValue={["description"]} className="mt-10 border-t">
              <InfoItem value="description" title="Description">
                {product.description.split("\n\n").map((p, i) => (
                  <p key={i} className="mb-3 last:mb-0">
                    {p}
                  </p>
                ))}
              </InfoItem>
              <InfoItem value="materials" title="Materials">
                <p>{product.materials}</p>
              </InfoItem>
              <InfoItem value="care" title="Care">
                <ul className="list-disc space-y-1.5 pl-5">
                  {product.care.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <Link to="/care" className="mt-4 inline-block underline underline-offset-4">
                  Our full guide to caring for wool
                </Link>
              </InfoItem>
              <InfoItem value="details" title="Fit & details">
                <ul className="list-disc space-y-1.5 pl-5">
                  {product.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </InfoItem>
            </Accordion>
          </div>
        </div>
      </div>

      <ProductReviews product={product} />

      {related.length > 0 && (
        <section className="mt-28">
          <h2 className="text-3xl md:text-4xl">More {category?.name.toLowerCase() ?? "pieces"}</h2>
          <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-12 lg:grid-cols-4 lg:gap-x-6">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function InfoItem({ value, title, children }: { value: string; title: string; children: React.ReactNode }) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="py-5 text-[0.95rem] font-medium hover:no-underline">{title}</AccordionTrigger>
      <AccordionContent className="pb-6 leading-relaxed text-muted-foreground">{children}</AccordionContent>
    </AccordionItem>
  )
}

function NotSavedOffline() {
  return (
    <div className="container-shop flex min-h-[50vh] flex-col items-start justify-center py-20">
      <p className="eyebrow">Offline</p>
      <h1 className="mt-4 text-4xl font-light">This piece isn't saved on this device yet.</h1>
      <p className="mt-4 max-w-md text-muted-foreground">It will open as soon as you're back online. Pieces you've already looked at are here while you're offline.</p>
      <Link to="/shop" className="mt-8 text-sm underline underline-offset-4">
        Back to the shop
      </Link>
    </div>
  )
}

function ProductSkeleton() {
  return (
    <div className="container-shop grid gap-10 pt-20 lg:grid-cols-12 lg:gap-16">
      <div className="aspect-[4/5] animate-pulse bg-muted lg:col-span-7" />
      <div className="space-y-4 lg:col-span-5">
        <div className="h-12 w-3/4 animate-pulse bg-muted" />
        <div className="h-6 w-1/4 animate-pulse bg-muted" />
        <div className="h-24 w-full animate-pulse bg-muted" />
      </div>
    </div>
  )
}
