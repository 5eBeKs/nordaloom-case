import { Link } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductImage, SitePhoto } from "@/components/art/ProductImage"
import { ProductCard, ProductGridSkeleton } from "@/components/ProductCard"
import { Newsletter } from "@/components/Newsletter"
import { useCategories, useProducts } from "@/lib/catalogue"
import { useTitle } from "@/hooks/use-title"

export function HomePage() {
  useTitle()
  const { data: products, isLoading } = useProducts()
  const { data: categories = [] } = useCategories()
  const featured = (products ?? []).filter((p) => p.is_featured).slice(0, 6)
  const newest = (products ?? []).filter((p) => p.is_new).slice(0, 4)

  return (
    <>
      {/* Hero */}
      <section className="relative h-[78svh] min-h-[520px] overflow-hidden lg:h-[calc(100svh-7rem)] lg:max-h-[880px] lg:min-h-[620px]">
        <SitePhoto path="site/wide-02.webp" alt="Carrying firewood in a grey wool sweater" eager className="absolute inset-0 object-[60%_center]" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        <div className="container-shop relative flex h-full flex-col justify-end pb-14 text-white md:justify-center md:pb-0">
          <p className="eyebrow text-white/80">Autumn · Winter 2026</p>
          <h1 className="mt-6 max-w-2xl text-[2.75rem] leading-[1.02] font-light sm:text-6xl xl:text-7xl">
            Wool, knitted <em className="font-light">slowly</em> in Latvia.
          </h1>
          <p className="mt-7 max-w-md text-lg leading-relaxed text-white/85">
            Sweaters, cardigans and blankets made in small batches from natural yarns — pieces meant to be worn,
            mended and handed on.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-6">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-none bg-background px-8 text-[0.8rem] tracking-[0.12em] text-foreground uppercase hover:bg-background/90"
            >
              <Link to="/shop">Shop the collection</Link>
            </Button>
            <Link to="/about" className="group inline-flex items-center gap-2 py-3 text-sm text-white underline-offset-8 hover:underline">
              How we make things <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="container-shop pt-24 md:pt-32">
        <SectionHeading eyebrow="The collection" title="Something warm for every part of the day" />
        <div className="-mx-5 mt-12 flex snap-x gap-4 overflow-x-auto px-5 pb-2 md:-mx-10 md:px-10 lg:mx-0 lg:grid lg:grid-cols-7 lg:gap-5 lg:overflow-visible lg:px-0">
          {categories.map((c) => {
            const sample = products?.find((p) => p.category_slug === c.slug)
            const zoom = "transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            return (
              <Link key={c.slug} to={`/shop/${c.slug}`} className="group block w-40 shrink-0 snap-start sm:w-48 lg:w-auto">
                <div className="aspect-[4/5] overflow-hidden bg-muted">
                  {c.image ? (
                    <SitePhoto path={c.image} alt={c.name} className={zoom} />
                  ) : (
                    sample && <ProductImage product={sample} className={zoom} />
                  )}
                </div>
                <h3 className="mt-4 text-xl">{c.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{c.tagline}</p>
              </Link>
            )
          })}
        </div>
      </section>

      {/* Featured */}
      <section className="container-shop pt-24 md:pt-32">
        <div className="flex items-end justify-between gap-6">
          <SectionHeading eyebrow="From the workshop" title="Pieces we're proud of" />
          <Link to="/shop" className="hidden shrink-0 items-center gap-2 text-sm underline-offset-8 hover:underline sm:inline-flex">
            View all <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-x-4 gap-y-12 md:grid-cols-3 md:gap-x-6">
          {isLoading ? <ProductGridSkeleton /> : featured.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      {/* Banner */}
      <section className="relative mt-24 h-[70svh] min-h-[420px] overflow-hidden md:mt-32">
        <SitePhoto path="site/wide-01.webp" alt="Looking out over a green valley in a grey cable knit" className="absolute inset-0 object-[40%_center]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <div className="container-shop relative flex h-full flex-col justify-end pb-14 text-white md:pb-20">
          <p className="eyebrow text-white/80">Cardigans</p>
          <h2 className="mt-4 max-w-xl text-4xl leading-tight font-light md:text-5xl">A layer for long walks and changeable skies.</h2>
          <Link to="/shop/cardigans" className="group mt-8 inline-flex items-center gap-2 text-sm underline-offset-8 hover:underline">
            Shop cardigans <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* Craft */}
      <section className="bg-linen">
        <div className="container-shop grid items-center gap-12 py-20 md:py-28 lg:grid-cols-2 lg:gap-20">
          <div className="relative pb-16 sm:pb-24">
            <div className="aspect-[4/3] overflow-hidden">
              <SitePhoto path="site/making-02.webp" alt="Knitting a mustard wool piece on circular needles" />
            </div>
            <div className="absolute right-0 bottom-0 aspect-[4/3] w-3/5 overflow-hidden border-[6px] border-linen sm:border-8">
              <SitePhoto path="site/making-01.webp" alt="Knitting a ribbed oat-coloured piece on wooden needles" />
            </div>
          </div>
          <div>
            <p className="eyebrow">How we make things</p>
            <h2 className="mt-4 text-4xl leading-tight md:text-5xl">Few pieces, made properly.</h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              We knit in small batches in Latvia, a few dozen pieces at a time. It's slower, but it means we can look
              at every sweater before it leaves.
            </p>
            <ol className="mt-10 space-y-8">
              {CRAFT_STEPS.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[3rem_1fr] gap-2">
                  <span className="font-serif text-lg text-clay">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="text-xl">{s.title}</h3>
                    <p className="mt-2 leading-relaxed text-muted-foreground">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Link to="/about" className="group mt-10 inline-flex items-center gap-2 text-sm underline-offset-8 hover:underline">
              Read more about our craft <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* New */}
      {newest.length > 0 && (
        <section className="container-shop pt-24 md:pt-32">
          <div className="flex items-end justify-between gap-6">
            <SectionHeading eyebrow="Just off the needles" title="New this season" />
            <Link to="/shop?sort=new" className="hidden shrink-0 items-center gap-2 text-sm underline-offset-8 hover:underline sm:inline-flex">
              See what's new <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-x-4 gap-y-12 lg:grid-cols-4 lg:gap-x-6">
            {newest.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* Promise */}
      <section className="container-shop py-24 md:py-32">
        <div className="grid gap-10 border-y py-14 md:grid-cols-3 md:gap-0 md:divide-x">
          {PROMISES.map((p) => (
            <div key={p.title} className="md:px-10 md:first:pl-0 md:last:pr-0">
              <h3 className="text-2xl">{p.title}</h3>
              <p className="mt-3 leading-relaxed text-muted-foreground">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <Newsletter />
    </>
  )
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 max-w-xl text-3xl leading-tight md:text-[2.6rem]">{title}</h2>
    </div>
  )
}

const CRAFT_STEPS = [
  {
    title: "Yarn",
    text: "We choose soft lambswool, merino and mohair for how they wear after years, not just how they feel in the shop. Many colours are kept close to the natural shade of the fleece.",
  },
  {
    title: "Knitting",
    text: "Each design is knitted in small runs, then linked and seamed by hand. Collars, cuffs and button bands are reinforced where knitwear usually gives out first.",
  },
  {
    title: "Finishing",
    text: "Every piece is washed, dried flat and checked stitch by stitch before it is folded and wrapped. If something isn't right, it doesn't go out.",
  },
]

const PROMISES = [
  {
    title: "Small batches",
    text: "We knit a few dozen of each design at a time. When a colour sells out, it comes back with the next batch — or not at all.",
  },
  {
    title: "Natural fibres",
    text: "Lambswool, merino and mohair. Our socks carry a little polyamide for strength; everything else is pure wool.",
  },
  {
    title: "Made to last",
    text: "Good wool, made properly and cared for, lasts decades. Our care guide shows you how to keep it that way.",
  },
]
