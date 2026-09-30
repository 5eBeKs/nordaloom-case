import { Link } from "react-router-dom"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { SizeTableView, measuresFor } from "@/components/shop/SizeGuide"
import { HOW_TO_MEASURE, SIZE_TABLES } from "@/lib/sizes"
import { useShopSettings } from "@/lib/checkout"
import { formatPrice } from "@/lib/format"
import { useTitle } from "@/hooks/use-title"
import { HelpPage, Section } from "./HelpLayout"

export function SizeGuidePage() {
  useTitle("Size guide")
  return (
    <HelpPage
      title="Size guide"
      intro={
        <p>
          All measurements are in centimetres. Each product page also says how that piece fits — whether it's our regular
          fit, relaxed, or cut long and roomy on purpose.
        </p>
      }
    >
      <nav aria-label="Size tables" className="mb-10 flex flex-wrap gap-2">
        {Object.values(SIZE_TABLES).map((t) => (
          <a key={t.key} href={`#${t.key}`} className="border border-input bg-card px-4 py-2 text-sm hover:border-foreground">
            {t.title}
          </a>
        ))}
      </nav>

      {Object.values(SIZE_TABLES).map((t) => (
        <Section key={t.key} id={t.key} title={t.title}>
          <p>{t.intro}</p>
          <SizeTableView table={t} />
          <p className="text-sm text-muted-foreground">
            {HOW_TO_MEASURE.filter((m) => measuresFor(t.key).includes(m.title))
              .map((m) => `${m.title}: ${m.text.charAt(0).toLowerCase()}${m.text.slice(1)}`)
              .join(" ")}
          </p>
        </Section>
      ))}

      <Section title="Scarves and blankets">
        <p>
          Scarves come in one size, and each blanket's size is given on its page — for example “Throw 130 × 170 cm”.
          Hand-finished knits can vary by a centimetre or two.
        </p>
      </Section>

      <Section title="Between sizes?">
        <p>
          For a closer fit, take the smaller size; to layer over a shirt or for a more relaxed look, take the larger.
          Reviews on each piece also say whether people found it small, true to size or large. And if you're still unsure,{" "}
          <Link to="/contact?topic=sizing">ask us</Link> — we'll measure the piece for you.
        </p>
      </Section>
    </HelpPage>
  )
}

export function FaqPage() {
  useTitle("Questions & answers")
  const { data: settings } = useShopSettings()
  const days = settings?.return_days ?? 14
  const payDays = settings?.payment_days ?? 5
  const free = settings ? formatPrice(settings.free_shipping_threshold_cents) : "€150"

  const groups: { title: string; items: { q: string; a: React.ReactNode }[] }[] = [
    {
      title: "Ordering and paying",
      items: [
        {
          q: "How do I pay?",
          a: (
            <p>
              By card or by bank transfer — you choose at checkout. Card payments are made on Stripe's secure payment page
              and your order is confirmed straight away. For a bank transfer, we show you our bank details and a payment
              reference (your order number) and email them to you as well; please use the reference so we can match your
              payment.
            </p>
          ),
        },
        {
          q: "Can I pay by card?",
          a: (
            <p>
              Yes. You pay on Stripe's secure payment page and come straight back to your order. We never see your card
              number. If you leave the payment page without paying, you can try again or switch to bank transfer from your
              order page.
            </p>
          ),
        },
        {
          q: "How long do I have to pay by bank transfer?",
          a: (
            <p>
              {payDays} days. We hold your pieces for you during that time and send a reminder two days before the end. If
              the payment hasn't arrived by then, the order is cancelled and the pieces go back on the shelf.
            </p>
          ),
        },
        {
          q: "Do I need an account?",
          a: (
            <p>
              No, you can order as a guest. An account lets you see all your orders in one place, save addresses, request
              returns yourself, keep a wish list and review what you've bought.
            </p>
          ),
        },
        {
          q: "Can I change or cancel my order?",
          a: (
            <p>
              If it hasn't been sent yet, yes — <Link to="/contact?topic=order">write to us</Link> with your order number.
              If you simply don't pay, an unpaid order cancels itself after {payDays} days.
            </p>
          ),
        },
        {
          q: "How do discount codes work?",
          a: (
            <p>
              Type the code in your bag and you'll see straight away what it takes off. One code per order. Some codes are
              for a first order only, or need a minimum amount — the bag tells you if a code doesn't apply.
            </p>
          ),
        },
      ],
    },
    {
      title: "Delivery",
      items: [
        {
          q: "Where do you deliver?",
          a: (
            <p>
              Everywhere in the European Union. In Latvia you can choose an Omniva parcel locker or a courier. See{" "}
              <Link to="/shipping">shipping & delivery</Link> for prices and times.
            </p>
          ),
        },
        { q: "Is delivery free?", a: <p>Yes, on orders over {free} (after any discount), to any EU country.</p> },
        {
          q: "How do I track my parcel?",
          a: <p>We email you the tracking number when your order leaves the workshop. It's also on your order page.</p>,
        },
      ],
    },
    {
      title: "Returns",
      items: [
        {
          q: "Can I return something?",
          a: (
            <p>
              Yes, within {days} days of delivery. You pay for the return postage unless the piece is faulty. Everything is on
              our <Link to="/returns">returns page</Link>.
            </p>
          ),
        },
        {
          q: "Can I exchange for another size?",
          a: <p>We can't swap directly, as our small batches rarely have a spare. Order the size you need and return the first one.</p>,
        },
      ],
    },
    {
      title: "Sizing",
      items: [
        {
          q: "How do your sweaters fit?",
          a: (
            <p>
              Most are a regular fit with room for a shirt underneath; some are relaxed or oversized, and the product page
              says so. The <Link to="/size-guide">size guide</Link> has the measurements.
            </p>
          ),
        },
        {
          q: "I'm between two sizes.",
          a: <p>Take the smaller for a closer fit, the larger for layering. The reviews on each piece often help too.</p>,
        },
      ],
    },
    {
      title: "Wool and care",
      items: [
        {
          q: "Will it itch?",
          a: (
            <p>
              It depends on the wool. Merino and lambswool are soft enough for most people to wear against the skin. Our
              Nordic wool is more rustic — warm and hard-wearing — and many people like it over a shirt. Each product page
              says which wool it is.
            </p>
          ),
        },
        {
          q: "Why is my sweater pilling?",
          a: (
            <p>
              A little pilling in the first weeks is natural: loose fibres work their way to the surface. Remove them with a
              wool comb and it settles down. More in our <Link to="/care">care guide</Link>.
            </p>
          ),
        },
        {
          q: "How often should I wash it?",
          a: <p>Rarely. Airing it overnight is usually enough. When it does need a wash: cold, by hand, with wool detergent, and dry flat.</p>,
        },
      ],
    },
    {
      title: "Our pieces",
      items: [
        {
          q: "Where are they made?",
          a: <p>In Latvia, in small batches. You can read more about how we work on <Link to="/about">our craft</Link> page.</p>,
        },
        {
          q: "Will a sold-out piece come back?",
          a: (
            <p>
              Often, yes — though colours change from batch to batch. Save it to your wish list, and join our newsletter to
              hear about restocks.
            </p>
          ),
        },
      ],
    },
  ]

  return (
    <HelpPage
      title="Questions & answers"
      intro={
        <p>
          The things people ask us most. If your question isn't here, <Link to="/contact" className="text-foreground underline underline-offset-4">write to us</Link>.
        </p>
      }
    >
      {groups.map((g) => (
        <section key={g.title} className="mb-12">
          <h2 className="text-2xl md:text-3xl">{g.title}</h2>
          <Accordion type="multiple" className="mt-4 border-t">
            {g.items.map((it) => (
              <AccordionItem key={it.q} value={it.q}>
                <AccordionTrigger className="py-5 text-left text-[0.95rem] font-medium hover:no-underline">{it.q}</AccordionTrigger>
                <AccordionContent className="prose-shop pb-6">{it.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      ))}
    </HelpPage>
  )
}
