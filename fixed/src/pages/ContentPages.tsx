import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductCard } from "@/components/ProductCard"
import { isSoldOut, useCategories, useProducts } from "@/lib/catalogue"
import { SitePhoto } from "@/components/art/ProductImage"
import { Newsletter } from "@/components/Newsletter"
import { useTitle } from "@/hooks/use-title"

export function AboutPage() {
  useTitle("Our craft")
  return (
    <>
      <header className="container-shop pt-14 pb-16 md:pt-24 md:pb-24">
        <p className="eyebrow">Our craft</p>
        <h1 className="mt-5 max-w-4xl text-5xl leading-[1.05] font-light md:text-7xl">
          We make a small number of things, and we make them to last.
        </h1>
      </header>

      <div className="h-[65svh] min-h-[380px] overflow-hidden">
        <SitePhoto path="site/wide-04.webp" alt="A grey wool rollneck among red autumn leaves" eager className="object-[40%_center]" />
      </div>

      <section className="container-shop grid gap-12 py-24 md:grid-cols-12 md:py-32">
        <h2 className="text-3xl md:col-span-4 md:text-4xl">A workshop, not a factory</h2>
        <div className="space-y-6 text-lg leading-relaxed text-muted-foreground md:col-span-7 md:col-start-6">
          <p>
            Nordaloom began with a simple idea: the sweaters our grandparents wore were better than most of what you
            can buy today. They were heavier, warmer, and they lasted — often long enough to be passed on.
          </p>
          <p>
            So we knit the way they were knitted: in small batches, in Latvia, with the patience that good wool asks
            for. Every design is tested through a Baltic winter before it goes into the shop.
          </p>
        </div>
      </section>

      <section className="bg-linen">
        <div className="container-shop grid gap-16 py-24 md:py-32 lg:grid-cols-3">
          {STORY.map((s) => (
            <article key={s.title}>
              <div className="aspect-[4/5] overflow-hidden">
                <SitePhoto path={s.photo} alt={s.alt} />
              </div>
              <h3 className="mt-8 text-2xl">{s.title}</h3>
              <p className="mt-3 leading-relaxed text-muted-foreground">{s.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="relative my-24 overflow-hidden md:my-32">
        <SitePhoto path="site/wide-03.webp" alt="Sitting on a mossy rock in a spring forest" className="absolute inset-0" />
        <div className="absolute inset-0 bg-black/45" />
        <div className="container-shop relative py-28 text-center text-white md:py-40">
          <p className="mx-auto max-w-3xl font-serif text-3xl leading-snug font-light md:text-4xl">
            “Buy less, choose well, make it last.” It's an old line, but we haven't found a better one.
          </p>
          <Button asChild size="lg" className="mt-12 h-12 rounded-none bg-background px-8 text-[0.8rem] tracking-[0.12em] text-foreground uppercase hover:bg-background/90">
            <Link to="/shop">Shop the collection</Link>
          </Button>
        </div>
      </section>

      <Newsletter />
    </>
  )
}

const STORY = [
  {
    title: "Natural yarns",
    text: "Lambswool for everyday warmth, merino where it sits against the skin, mohair for lightness. Many colours stay close to the fleece; the rest are chosen to sit well together.",
    photo: "site/making-01.webp",
    alt: "Knitting an oat-coloured rib on wooden needles",
  },
  {
    title: "Knitted in small runs",
    text: "A few dozen pieces of each design at a time. It keeps us close to the work — and means nothing sits in a warehouse for years.",
    photo: "site/making-02.webp",
    alt: "A mustard wool piece taking shape on circular needles",
  },
  {
    title: "Finished by hand",
    text: "Seams are linked by hand, then every piece is washed, dried flat and checked before it's folded and sent to you.",
    photo: "products/sweater-12.webp",
    alt: "A stack of folded grey and oat sweaters",
  },
]

export function CarePage() {
  useTitle("Caring for wool")
  return (
    <div className="container-shop pt-14 md:pt-24">
      <p className="eyebrow">Caring for wool</p>
      <h1 className="mt-5 max-w-3xl text-5xl leading-[1.05] font-light md:text-6xl">Less washing, more wearing.</h1>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        Wool is naturally odour-resistant and cleans itself remarkably well with fresh air. Treated gently, a good
        sweater gets better with age. Here's how we look after ours.
      </p>

      <div className="mt-20 grid gap-x-16 gap-y-14 md:grid-cols-2">
        {CARE.map((c, i) => (
          <section key={c.title} className="grid grid-cols-[3rem_1fr] border-t pt-8">
            <span className="font-serif text-lg text-clay">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h2 className="text-2xl">{c.title}</h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">{c.text}</p>
            </div>
          </section>
        ))}
      </div>

      <p className="mt-20 max-w-2xl text-muted-foreground">
        Every product page lists care instructions for that particular piece — mohair, chunky knits and socks each
        have their own small quirks.
      </p>
    </div>
  )
}

const CARE = [
  {
    title: "Air it out",
    text: "After wearing, hang your knit over a chair back or lay it flat near an open window overnight. Most of the time that's all it needs.",
  },
  {
    title: "Wash rarely, and cold",
    text: "When it does need a wash, use cool water (max 30 °C) and a wool detergent. Soak gently for ten minutes; don't rub, twist or wring.",
  },
  {
    title: "Dry flat",
    text: "Roll the piece in a towel to press out the water, then reshape it and dry it flat, away from radiators and direct sun. Never tumble dry.",
  },
  {
    title: "Fold, don't hang",
    text: "Hangers stretch shoulders. Fold your knits and store them on a shelf or in a drawer, with cedar or lavender to keep moths away.",
  },
  {
    title: "Deal with pilling",
    text: "A little pilling in the first weeks is natural as loose fibres work their way out. Remove it with a wool comb or sweater stone, not a razor.",
  },
  {
    title: "Mend small holes early",
    text: "A small hole is quick to darn; a big one is not. Keep a little matching yarn and darn it as soon as you notice.",
  },
]

export function NotFoundPage() {
  useTitle("Page not found")
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const { data: categories = [] } = useCategories()
  const { data: products = [] } = useProducts()
  const picks = products.filter((p) => p.is_featured && !isSoldOut(p)).slice(0, 4)

  return (
    <div className="container-shop pt-16 md:pt-24">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="eyebrow">Page not found</p>
          <h1 className="mt-5 text-5xl leading-[1.05] font-light md:text-7xl">This thread leads nowhere.</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            The page you were looking for isn't here. It may have moved, the link may have a typo, or the piece may have
            sold out and left the shop. Try searching, or start from one of these.
          </p>
          <form
            role="search"
            className="mt-10 flex max-w-lg"
            onSubmit={(e) => {
              e.preventDefault()
              if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`)
            }}
          >
            <label htmlFor="notfound-search" className="sr-only">
              Search the shop
            </label>
            <input
              id="notfound-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search for a sweater, a colour, a wool…"
              className="h-12 min-w-0 flex-1 border border-r-0 border-input bg-card px-4 text-sm outline-none focus-visible:border-ring"
            />
            <Button type="submit" className="h-12 rounded-none px-6">
              Search
            </Button>
          </form>
        </div>
        <nav aria-label="Shop" className="lg:col-span-4 lg:col-start-9">
          <p className="eyebrow">Or browse</p>
          <ul className="mt-4 border-t">
            {[{ slug: "", name: "All knitwear" }, ...categories].map((c) => (
              <li key={c.slug} className="border-b">
                <Link to={c.slug ? `/shop/${c.slug}` : "/shop"} className="flex items-center justify-between py-3 font-serif text-xl hover:text-clay">
                  {c.name} <ArrowRight className="size-4" strokeWidth={1.5} />
                </Link>
              </li>
            ))}
            <li className="border-b">
              <Link to="/contact" className="flex items-center justify-between py-3 text-sm text-muted-foreground hover:text-foreground">
                Looking for something in particular? Ask us <ArrowRight className="size-4" strokeWidth={1.5} />
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      {picks.length > 0 && (
        <section className="mt-24">
          <h2 className="text-3xl md:text-4xl">A few favourites</h2>
          <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-12 lg:grid-cols-4 lg:gap-x-6">
            {picks.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
