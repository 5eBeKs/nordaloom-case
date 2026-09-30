import { Link } from "react-router-dom"
import { useShopSettings } from "@/lib/checkout"
import { COMPANY, POLICIES_UPDATED, TO_BE_ADDED } from "@/lib/company"
import { useTitle } from "@/hooks/use-title"
import { HelpPage, Section } from "./HelpLayout"

function CompanyDetails({ email }: { email: string }) {
  return (
    <div className="border bg-card p-5 text-sm leading-relaxed">
      <p className="font-medium text-foreground">{COMPANY.name}</p>
      {COMPANY.address.map((l) => (
        <p key={l} className="!mt-0">
          {l}
        </p>
      ))}
      <p className="!mt-3">Registration No.: {COMPANY.registrationNumber ?? <em>{TO_BE_ADDED}</em>}</p>
      <p className="!mt-0">VAT No.: {COMPANY.vatNumber ?? <em>{TO_BE_ADDED}</em>}</p>
      <p className="!mt-0">
        Email: <a href={`mailto:${email}`}>{email}</a>
      </p>
    </div>
  )
}

export function TermsPage() {
  useTitle("Terms of sale")
  const { data: s } = useShopSettings()
  const email = s?.contact_email ?? "owner@nordaloom.example"
  const payDays = s?.payment_days ?? 5
  const returnDays = s?.return_days ?? 14

  return (
    <HelpPage
      eyebrow="The small print"
      title="Terms of sale"
      updated={POLICIES_UPDATED}
      intro={<p>These terms apply when you buy from Nordaloom. We've tried to keep them short and plain.</p>}
    >
      <Section id="who" title="1. Who we are">
        <p>The shop is run by:</p>
        <CompanyDetails email={email} />
        <p>
          These terms are for customers buying as consumers. Your rights under the consumer law of the country you
          live in are not affected by anything here.
        </p>
      </Section>

      <Section id="orders" title="2. Your order">
        <p>
          Everything in the shop is subject to availability — we knit in small batches. When you place an order, we
          confirm it on screen and by email with your order number, and that is when our contract with you begins. You
          can order as a guest or with an account.
        </p>
        <p>
          If we can't fulfil an order (for example, a piece turns out to be damaged), we'll tell you straight away and
          refund anything you've already paid.
        </p>
      </Section>

      <Section id="prices" title="3. Prices">
        <p>
          Prices are in euros and include 21% Latvian VAT. The delivery cost is shown in your bag and at checkout before
          you order. The price you pay is the one shown when you place the order.
        </p>
      </Section>

      <Section id="payment" title="4. Payment">
        <p>
          You can pay by card or by bank transfer. <strong>By card</strong>, you pay on the secure payment page of our
          payment provider, Stripe, straight after placing your order; if the payment isn't completed within about half
          an hour, the order is cancelled and the pieces go back into the shop. Your card is charged only when you
          confirm the payment there.
        </p>
        <p>
          <strong>By bank transfer</strong>, you pay to the account shown on your order confirmation, using your order
          number as the payment reference. We hold your pieces for {payDays} days. If your payment hasn't arrived by
          then, the order is cancelled automatically and the pieces go back into the shop. If a payment arrives after
          cancellation, we refund it in full.
        </p>
      </Section>

      <Section id="discounts" title="5. Discount codes">
        <p>
          One code can be used per order. Codes have no cash value and can't be exchanged. Some codes are valid only
          until a date, for a minimum order, for a first order, or once per customer — the conditions are shown when you
          enter the code. If you return pieces from an order that used a code, the refund is based on what you actually
          paid.
        </p>
      </Section>

      <Section id="delivery" title="6. Delivery">
        <p>
          We deliver within the European Union only. Delivery options, prices and usual times are on our{" "}
          <Link to="/shipping">shipping page</Link>. Times are estimates; if your order hasn't arrived within 30 days of
          being sent, tell us and you may cancel it for a full refund. The pieces are your responsibility from the moment
          they're delivered to you or to the parcel locker you chose.
        </p>
      </Section>

      <Section id="withdrawal" title="7. Your right to change your mind">
        <p>
          You may cancel your purchase for any reason within {returnDays} days of the day you (or someone you name)
          receive the pieces. To do so, request a return in your account or tell us by email or through our{" "}
          <Link to="/contact?topic=returns">contact form</Link> — a clear statement is enough. You must then send the
          pieces back within 14 days of telling us. You pay the cost of sending them back.
        </p>
        <p>
          We refund the price of the returned pieces — and, if you return the whole order, the standard delivery cost —
          within 14 days of hearing from you, using the same payment method: back to your card, or by bank transfer. We may wait until the pieces are back or
          you've shown us they've been sent. If pieces are returned worn, washed or damaged beyond what's needed to try
          them on, we may reduce the refund accordingly. Details are on our <Link to="/returns">returns page</Link>.
        </p>
      </Section>

      <Section id="faults" title="8. If something is wrong">
        <p>
          Every piece should be as described and free of faults. If it isn't, you have the legal guarantee: we'll repair
          or replace it, or refund you, and pay the return postage. This applies to faults that show within two years of
          delivery. Please tell us as soon as you notice, ideally within two months. Normal wear — such as light pilling —
          is not a fault.
        </p>
      </Section>

      <Section id="reviews" title="9. Reviews">
        <p>
          Only customers whose order of a piece has been delivered can review it, and each review is marked “Bought from
          Nordaloom”. We read every review before it appears. We publish good and bad reviews alike, and don't edit
          them; we may decline reviews that are offensive, not about the piece, or that contain personal details. We
          sometimes reply under a review as the shop. Reviews show your first name and the first letter of your surname.
        </p>
      </Section>

      <Section id="accounts" title="10. Your account">
        <p>
          Keep your password to yourself; you're responsible for what happens in your account. You can ask us to close
          your account at any time.
        </p>
      </Section>

      <Section id="liability" title="11. Our responsibility">
        <p>
          We're responsible for loss or damage you suffer that is a foreseeable result of our breaking these terms or
          failing to use reasonable care. We're not responsible for loss that wasn't foreseeable, or for business losses.
          Nothing here limits our responsibility where the law doesn't allow it to be limited.
        </p>
      </Section>

      <Section id="law" title="12. Law and disputes">
        <p>
          These terms are governed by the law of Latvia. If you live elsewhere in the EU, you also keep the protection of
          the mandatory consumer law of your own country, and you can bring a claim in your local courts.
        </p>
        <p>
          If you have a complaint, please <Link to="/contact">write to us</Link> first — we'll do our best to put it
          right. If we can't agree, you can turn to the Consumer Rights Protection Centre of Latvia (PTAC), or to the
          consumer authority in your own country.
        </p>
      </Section>

      <Section id="changes" title="13. Changes">
        <p>We may update these terms from time to time. The terms that apply to your order are the ones on this page when you placed it.</p>
      </Section>
    </HelpPage>
  )
}

export function PrivacyPage() {
  useTitle("Privacy")
  const { data: s } = useShopSettings()
  const email = s?.contact_email ?? "owner@nordaloom.example"

  return (
    <HelpPage
      eyebrow="The small print"
      title="Privacy"
      updated={POLICIES_UPDATED}
      intro={<p>What we know about you, why, and what you can ask us to do with it. We collect as little as we can and never sell it.</p>}
    >
      <Section id="who" title="Who looks after your data">
        <p>{COMPANY.name} is responsible for your personal data (the “controller”). For anything about your data, write to us:</p>
        <CompanyDetails email={email} />
      </Section>

      <Section id="what" title="What we collect, and why">
        <h3>When you order</h3>
        <p>
          Your name, email, phone number and delivery address, what you ordered, and whether you've paid. We need these
          to deliver your order, answer questions about it and handle returns (the contract with you), and to keep
          accounting records (a legal obligation). If you pay by bank transfer, your bank's name for you and your
          account number reach us with your transfer, and are used only to match and refund payments. If you pay by
          card, we keep the card's type and last four digits.
        </p>
        <h3>If you create an account</h3>
        <p>
          Your email, name and password (stored in a scrambled form we can't read), your saved addresses, orders, wish
          list and reviews. These let you use the account.
        </p>
        <h3>If you join the newsletter</h3>
        <p>
          Your email address, to send you our letters — only because you asked us to (your consent). You can leave at any
          time by replying to any letter.
        </p>
        <h3>If you write a review</h3>
        <p>
          Your rating, words and the fit you chose. The review is shown with your first name and the first letter of your
          surname; we don't show your email or anything else.
        </p>
        <h3>If you contact us</h3>
        <p>Your name, email, and what you wrote, to answer you.</p>
      </Section>

      <Section id="browser" title="What we keep in your browser">
        <p>
          We don't use advertising or tracking cookies, and no analytics. To make the shop work, your browser keeps a few
          things for us in its local storage:
        </p>
        <ul>
          <li>your bag and any discount code you entered,</li>
          <li>your wish list, if you're not signed in,</li>
          <li>that you're signed in, if you are,</li>
          <li>that you've seen our note about this, so it doesn't appear again,</li>
          <li>on the order page, a key that lets you see an order you placed as a guest.</li>
        </ul>
        <p>These are needed for the shop to work, so we don't ask for consent for them. Clearing your browser's data removes them.</p>
      </Section>

      <Section id="sharing" title="Who we share it with">
        <ul>
          <li><strong>Delivery companies</strong> (Omniva and our courier) get your name, address and phone number to bring your parcel.</li>
          <li>
            <strong>Stripe</strong>, our card payment provider, if you pay by card: you enter your card details on
            Stripe's page, and we never see or store your card number — only its type and last four digits, to recognise
            the payment.
          </li>
          <li><strong>Our bank</strong> handles bank transfers and refunds.</li>
          <li>
            <strong>The companies that run the shop for us</strong> — hosting and the database ({COMPANY.hosting ?? <em>provider {TO_BE_ADDED}</em>}),
            and the service that sends our emails — only store and process data on our instructions.
          </li>
          <li><strong>Our accountant and the authorities</strong>, where the law requires it.</li>
        </ul>
        <p>We don't sell your data, and we don't share it with advertisers.</p>
      </Section>

      <Section id="how-long" title="How long we keep it">
        <ul>
          <li>Order and payment records: as long as Latvian accounting law requires us to keep them.</li>
          <li>Your account: until you ask us to close it.</li>
          <li>Newsletter: until you leave it.</li>
          <li>Messages to us: up to two years after we've answered, unless they're part of an order record.</li>
        </ul>
      </Section>

      <Section id="rights" title="Your rights">
        <p>
          You can ask us for a copy of your data, to correct it, to delete it, to limit how we use it, or to receive it in
          a form you can take elsewhere. You can object to how we use it, and withdraw your consent for the newsletter at
          any time. Just <Link to="/contact">write to us</Link>; we'll answer within a month. Some things we have to keep
          by law, such as accounting records — we'll tell you if that applies.
        </p>
        <p>
          If you think we've handled your data wrongly, you can complain to the Data State Inspectorate of Latvia (Datu
          valsts inspekcija) or to the data protection authority where you live.
        </p>
      </Section>
    </HelpPage>
  )
}
