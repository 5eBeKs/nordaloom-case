import { Link } from "react-router-dom"
import { countryName, useShippingRates, useShopSettings } from "@/lib/checkout"
import { formatPrice } from "@/lib/format"
import { useTitle } from "@/hooks/use-title"
import { HelpPage, Section } from "./HelpLayout"

// Rough delivery times after dispatch, per shipping rate. Drafts: check with the carriers.
const DELIVERY_TIME: Record<string, string> = {
  omniva_lv: "1–2 working days",
  courier_lv: "1–2 working days",
  courier_baltic: "2–4 working days",
  courier_eu: "3–7 working days",
}

export function ShippingPage() {
  useTitle("Shipping & delivery")
  const { data: rates = [] } = useShippingRates()
  const { data: settings } = useShopSettings()
  const free = settings ? formatPrice(settings.free_shipping_threshold_cents) : "€150"
  const eu = rates.find((r) => r.code === "courier_eu")

  return (
    <HelpPage
      title="Shipping & delivery"
      intro={<p>We send every order from our workshop in Kuldiga, Latvia, to anywhere in the European Union. Delivery is free on orders over {free}.</p>}
    >
      <Section title="Where we deliver, and what it costs">
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-foreground/30 text-left">
                <th scope="col" className="py-3 pr-4 font-medium">Where</th>
                <th scope="col" className="py-3 pr-4 font-medium">How</th>
                <th scope="col" className="py-3 pr-4 font-medium">Usually arrives</th>
                <th scope="col" className="py-3 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.code} className="border-b align-top">
                  <td className="py-3 pr-4">
                    {r.code === "courier_eu" ? "Rest of the EU" : r.countries.map(countryName).join(" and ")}
                  </td>
                  <td className="py-3 pr-4">{r.label}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{DELIVERY_TIME[r.code] ?? "—"} after we send it</td>
                  <td className="py-3 text-right tabular-nums">{formatPrice(r.price_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <strong>Free delivery on orders over {free}</strong>, whichever way you choose. The {free} counts after any
          discount code.
        </p>
        {eu && <p className="text-sm text-muted-foreground">“Rest of the EU” means {eu.countries.map(countryName).join(", ")}.</p>}
        <p>
          We don't ship outside the European Union for now — including to the United Kingdom, Norway and Switzerland.
          Within the EU there are no customs duties or extra taxes to pay on delivery: the price you see includes 21%
          Latvian VAT.
        </p>
      </Section>

      <Section title="When we send your order">
        <p>
          Pay by card and your order goes to be packed straight away. Pay by bank transfer and we hold your pieces for{" "}
          {settings?.payment_days ?? 5} days while the transfer arrives — transfers between banks in the EU usually take
          one working day. Either way, we pack your order within 1–2 working days of receiving the payment.
        </p>
        <p>
          When your parcel leaves the workshop we write to you with the tracking number, and you'll see it on your order
          page too.
        </p>
      </Section>

      <Section title="Omniva parcel lockers">
        <p>
          In Latvia you can have your order sent to any Omniva parcel locker — choose it at checkout. Omniva sends you a
          text message with the code when the parcel is ready to collect, and keeps it in the locker for a few days.
        </p>
      </Section>

      <Section title="If something goes wrong">
        <ul>
          <li>
            <strong>Wrong address?</strong> Write to us as soon as possible. We can change it until the parcel has left
            the workshop.
          </li>
          <li>
            <strong>Parcel late or lost?</strong> Check the tracking link first; if it hasn't moved for several days,{" "}
            <Link to="/contact?topic=order">get in touch</Link> and we'll chase it with the carrier.
          </li>
          <li>
            <strong>Arrived damaged?</strong> Take a photo of the parcel and the piece and <Link to="/contact?topic=order">write to us</Link>.
            We'll put it right.
          </li>
        </ul>
      </Section>
    </HelpPage>
  )
}

export function ReturnsPage() {
  useTitle("Returns")
  const { data: settings } = useShopSettings()
  const days = settings?.return_days ?? 14
  const address = settings?.return_address.split("\n") ?? ["Nordaloom SIA", "Liela iela 12", "Kuldiga, LV-3301", "Latvia"]

  return (
    <HelpPage
      title="Returns"
      intro={<p>If a piece isn't right, you can send it back within {days} days of delivery for a refund — no reason needed.</p>}
    >
      <Section title="The short version">
        <ul>
          <li>You have <strong>{days} days from the day your order is delivered</strong> to tell us you'd like to return something.</li>
          <li>Send the pieces back unworn and unwashed.</li>
          <li><strong>You pay for the return postage</strong>, unless the piece is faulty or we sent the wrong thing — then we pay.</li>
          <li>We refund the pieces the way you paid: back to your card, or to the bank account you paid from.</li>
        </ul>
      </Section>

      <Section title="How to return">
        <ol>
          <li>
            <strong>Tell us.</strong> If you ordered with an account, open the order in{" "}
            <Link to="/account">your account</Link> and choose “Request a return”. If you ordered as a guest,{" "}
            <Link to="/contact?topic=returns">write to us</Link> with your order number and what you'd like to return.
          </li>
          <li>
            <strong>Wait for our reply.</strong> We'll confirm the return and where to send it — please don't post
            anything before that.
          </li>
          <li>
            <strong>Send the pieces</strong> to the address below, well packed, with a note of your return number
            inside. We recommend a tracked service and keeping the receipt until your refund arrives.
          </li>
          <li>
            <strong>Your refund.</strong> Once the pieces are back and checked, we refund them the way you paid.
          </li>
        </ol>
        <div className="border bg-card p-5 text-sm leading-relaxed">
          <p className="eyebrow">Return address</p>
          <p className="mt-2 text-foreground">
            {address.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </p>
        </div>
      </Section>

      <Section title="Refunds">
        <p>
          We refund within 14 days of your telling us about the return, and may wait until the pieces are back with us
          (or you've shown us you've sent them). Card payments are refunded to the same card, which usually takes 5–10
          working days to show on your statement. Bank transfers are refunded to the account you paid from, and can
          take a working day or two to appear.
        </p>
        <p>
          If you return your <strong>whole order</strong>, we also refund what you paid for delivery. If you return only
          some pieces, delivery isn't refunded. If your order used a discount code, the refund is what you actually paid
          for the pieces, after the discount.
        </p>
      </Section>

      <Section title="Condition">
        <p>
          Please try pieces on as you would in a shop. If something comes back worn, washed, smelling of smoke or
          perfume, or damaged, we may refuse the return or refund less to cover the loss in value — and we'll always
          tell you why.
        </p>
      </Section>

      <Section title="Faulty pieces">
        <p>
          We check every piece before it's sent, but if something is wrong — a dropped stitch, a flaw in the yarn, a seam
          coming undone — tell us as soon as you notice, with a photo if you can. We'll pay the return postage and repair,
          replace or refund it. This applies for two years from delivery, as EU law requires, and doesn't depend on the
          {` ${days}`}-day return window.
        </p>
        <p className="text-sm text-muted-foreground">
          Wool naturally pills a little in the first weeks of wear, and that isn't a fault. Our{" "}
          <Link to="/care">care guide</Link> explains how to deal with it.
        </p>
      </Section>

      <Section title="Exchanges">
        <p>
          We can't swap sizes directly, because our small batches often don't have a spare. The quickest way is to
          order the size you need and return the first one.
        </p>
      </Section>
    </HelpPage>
  )
}
