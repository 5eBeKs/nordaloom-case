# Nordaloom shop

React + TypeScript + Vite + Tailwind + shadcn/ui, on Supabase.

## Running

```sh
npm install
npm run dev -- --port 3300
```

Supabase connection details live in `.env.local` (local project: API on `127.0.0.1:57321`).

## Database

- Schema: `supabase/migrations/` — apply with `npm run db:migrate`.
- Sample catalogue (40 products): edit `scripts/catalogue.mjs`, then
  `npm run db:build-seed && npm run db:seed`. **Re-seeding replaces all products and empties carts.**

Tables: `categories`, `products` (price in euro cents incl. VAT, colours, sizes, care, images),
`product_variants` (stock per colour × size, optional price override), `profiles` (role
`customer` / `owner`), `cart_items`, `newsletter_subscribers`. A public `product-images`
storage bucket is ready for photos; only the owner can upload.

## Owner account

The owner account is **owner@nordaloom.example**: signing up with that address makes the
account the shop owner (see the `handle_new_user` trigger). Every other account is a customer. Row-level security already lets the owner edit the
catalogue, stock, photos and read newsletter subscribers — the admin screens are next.

## Photos

Originals live in `owner-photos/`. `npm run photos:upload` resizes them to WebP and uploads
them to the public `product-images` bucket (`products/…` for product photos, `site/…` for
`wide-*` and `making-*`). Products and categories refer to those paths in
`scripts/catalogue.mjs`; the home and About pages use the `site/` photos directly.

Products without a photo are kept in the catalogue with `published: false`, so they don't
appear in the shop until a photo is added. (Unpublished products still have drawn
placeholders, from `src/components/art/`, which the owner will see in the admin later.)

## Search and filters

Search (header, or `/` on the keyboard; results page at `/search?q=`) runs in the browser
over the published catalogue: every word must match the name, category, colour, material or
description, accents are ignored ("kapa" finds Kāpa) and a few everyday words are understood
(jumper, beanie, gloves, throw, grey/gray, cream…) — see `src/lib/search.ts`.

Catalogue and search pages filter by size, colour family, price band and "only what's in
stock" (`src/components/shop/filters.tsx`); filters live in the URL. Colour families are
worked out from each colour's hex value, so new colours sort themselves.

## Checkout and orders

Customers pay by bank transfer. `place_order()` (a database function) checks the details,
locks the stock rows, re-prices everything from the database, takes the stock down and saves
the order as **awaiting payment** — all in one transaction, so the last piece can't be sold
twice. The customer then sees `/order/<number>` with the bank details and payment reference
(the order number). Guests can open that page through its secret link; signed-in customers
also see their orders in their account.

Unpaid orders have a payment deadline (`shop_settings.payment_days`, 5 days). A pg_cron job
runs `cancel_overdue_orders()` every 5 minutes: overdue orders are cancelled and their pieces
go back in stock.

The owner manages orders in the admin (below): mark as paid → shipped (with a tracking
number) → delivered, or cancel (cancelling puts the stock back).

## Discount codes

Made at `/admin/discounts`: a percentage or fixed amount off the pieces (not delivery), with
an optional last day, total use limit, minimum order, "first order only" and "once per
customer" (by account or email). The bag checks a code live (`check_discount()`); checkout
re-checks it with the customer's email, and `place_order()` checks it for real with the code
row locked, so the last allowed use can't be taken twice. Free delivery counts from the amount
after the discount. A use is an order placed with the code that wasn't cancelled; cancelled
orders give the use back. Used codes can be paused but not deleted. When refunding a return
from a discounted order, the suggested amount is what the customer actually paid for the pieces.

## Emails

Eleven emails; their templates are in `supabase/functions/_shared/emails/` (plain TypeScript,
shared by the server functions that send them and by the admin, which previews them; the shop
imports them as `@emails/…`): order confirmation with bank details, payment reminder (two days
before the deadline), order cancelled (only when an unpaid order passes its deadline, not when
the owner cancels), payment received, shipped (with tracking), delivered, return approved,
return refused, refund sent, the newsletter welcome with the welcome code
(`shop_settings.welcome_discount_code`, WELCOME10), and password reset.

How sending works:

1. Database triggers write each email to the `emails` table with a snapshot of its details
   (status `queued`).
2. The insert wakes the `send-emails` server function (pg_net → `shop_settings.functions_url`),
   and a pg_cron job does the same every minute while anything is waiting.
3. The function claims a batch (`claim_emails()`, so two runs never send the same email),
   renders it, sends it and records the result (`finish_email()`): `sent`, or `failed` with the
   error. Failures are retried after 1, 5, 15 and 60 minutes, five tries in all. The owner can
   also press "Send again".
4. Only emails created after `shop_settings.email_sending_since` (when sending was switched on)
   are sent. Everything older is marked `skipped` ("Not sent"), and anything that waited over two
   days without going out is skipped too, rather than arriving late.

Where mail goes is set in `supabase/functions/.env`: `MAILPIT_URL` sends everything to the local
test mailbox (http://127.0.0.1:57324), so nothing reaches real people. For the live shop, set
`RESEND_API_KEY` (and `EMAIL_FROM`) instead. Links in emails use `shop_settings.site_url`, so set
it to the real address before going live.

**Forgot password:** `/forgot-password` calls the `password-reset` function. If the address has an
account, it creates a one-time recovery link (`auth/v1/admin/generate_link`, valid for
`auth.email.otp_expiry`, one hour) and emails it in the shop's style. The answer is the same
whether or not the account exists, and there are at most 3 emails per address per hour. The link
opens `/reset-password`, which checks it only when the new password is saved. The copy kept in
the admin leaves the link out.

The functions have `verify_jwt = false` in `supabase/config.toml` (the database and signed-out
visitors call them). **The local edge runtime loads functions when Supabase starts**, so after
adding or changing a function, restart the local Supabase (`npx supabase stop` then
`npx supabase start`). Until then, emails wait in the outbox as `queued` and are sent within a
minute of the restart, as long as they are under two days old.

## Reviews and wish list

Reviews: a signed-in customer can review a piece once an order containing it is `delivered`
(`submit_review()`): 1–5 stars, a few words, and how it fits (small / true to size / large —
not asked for scarves and blankets). One review per customer per piece; changing it sends it
back to be read. Every review waits as `pending` until the owner publishes it at
`/admin/reviews`, where they can also reply as the shop (shown under the review). Published
reviews are public, but who wrote them (`user_id`) isn't readable from the shop; the name shown
is "First L.". `products.rating_avg` / `rating_count` are kept up to date by a trigger and drive
the stars on catalogue cards. Customers see their reviews at `/account/reviews`.

Wish list: the heart on every piece. Guests keep the list in the browser; signed-in customers
in `wishlist_items`, and signing in moves the browser list into the account. Page: `/wishlist`.

## Help and policy pages

`/shipping`, `/returns`, `/size-guide`, `/faq`, `/contact`, `/terms`, `/privacy` (in
`src/pages/help/`). They are **drafts to be checked** before launch. Prices, the free-delivery
threshold, payment and return days, return address and contact email come from the database;
the rest is text in the page files. Placeholders:

- Company registration and VAT numbers, and the hosting provider: `src/lib/company.ts`
  (shown as "to be added" until filled in).
- Delivery times per shipping option: `DELIVERY_TIME` in `ShippingReturnsPages.tsx`.
- Size tables (all measurements): `src/lib/sizes.ts` — also used by the "Size guide" link on
  product pages.

Contact form: `send_contact_message()` stores messages in `contact_messages` (max 5 per address
per hour); the owner reads them at `/admin/messages`, replies by email (a button opens the email
program with the message quoted) and marks them answered.

The cookie notice (`CookieNotice.tsx`) is informational only: the shop sets no tracking or
analytics cookies, just local storage the shop needs (bag, wish list, sign-in, guest order keys).
If analytics or marketing tools are ever added, it has to become a real consent banner.

## Light and dark

The shop follows the device's light or dark setting, including when it changes in the evening
while the shop is open. The switch in the footer (and at the bottom of the admin menu) offers
Auto, Light or Dark and is remembered per device. The dark palette is the `.dark` block in
`src/index.css`: the same names (background, foreground, clay, moss, sand, linen) with evening
values, so components need nothing special. A small script in `index.html` applies the choice
before the first paint, so there's no flash. Photos are dimmed very slightly in dark mode
(`brightness(0.94)`) to take off the glare. Emails always stay light.

Checked at phone width (375px) in both themes, for the customer's side and the admin, with
axe-core (contrast and tap-target size) plus checks for anything wider than the screen.
axe-core is installed as a development tool (it never reaches customers); the check itself was
a one-off script, so to re-check after bigger changes, run axe on the pages again.

## The shop as an app (install, offline)

- **Install:** `public/manifest.webmanifest` plus icons in `public/icons/` (made by
  `node scripts/make-icons.mjs`). "Get the app" in the footer and the phone menu installs it in
  one tap where the browser allows (Android/Chrome), or shows the two steps on an iPhone.
  Installed, it opens full screen with its own icon.
- **Service worker** (`public/sw.js`):
  - pages come from the network first, with the last copy used offline;
  - fingerprinted build files come from the cache;
  - product photos come from the cache and are refreshed in the background (at most 400);
  - data is never cached there.
  If you change `sw.js`, bump `VERSION`; open apps then show "A new version of the shop is
  ready — Refresh".
- **What customers have seen is kept on the device** (`src/lib/offline.ts`, TanStack Query
  persisted to localStorage for 14 days): categories, products, the bag's pieces, shipping and
  settings, the account's orders, order pages, addresses and reviews. Admin data is never kept.
  A customer's own data is forgotten when they sign out.
- **Bag and wish list offline:** signed-in customers' bag and wish list also live on the device.
  Changes made offline are marked and sent when the connection returns; the device's version
  wins.
- **Offline or not** (`src/lib/connection.ts`): the phone's own flag, plus whether requests to the
  shop actually get through. That covers trains and café logins, which report "online". While
  offline, a bar says so and queries wait instead of failing.
- **Ordering once:** checkout sends a random key with each attempt (kept for 12 hours). The
  database returns the existing order if the same key arrives again within a day, so a double
  tap or a retry after a dropped connection never makes two orders. Offline, the checkout keeps
  everything and says it will be possible once back online.
- **Fresh prices and stock:** product and variant changes are published through Supabase
  Realtime (migration `…236000_live_catalogue.sql`). Open shops and apps reload what's on screen
  within a second or two, and again whenever the connection or the app comes back. Checkout
  always uses the database's current prices and stock anyway.
- **HTTPS required:** service workers and installing only work on `https://` addresses, or on
  `localhost` on the same computer. A phone opening the development server by its network
  address gets the normal website, without the app features.

## Reports (`/admin/reports`)

Any period (presets or two dates), shown by day, week or month, compared with the period of the
same length just before it. Sections: sales, categories, pieces, sizes and colours (with what's
in stock but not selling), new and returning customers and second orders, returns and reasons,
discount codes, orders never paid (by payment method), and delivery countries.

Everything is worked out in the database by `admin_report(from, to, group)` (owner only), in
Latvian time. The definitions match the dashboard: a **sale** is an order that was paid and not
cancelled, dated by the day it was placed; **sales** include VAT and delivery, after discounts.
Refunds count on the day they were made, and a **customer** is an email address. Category,
piece, size and colour figures are pieces before discounts.

Every table downloads as an Excel file (.xlsx, written in the browser by `src/lib/xlsx.ts`),
and "Download everything" puts all of them in one workbook with a sheet each. Euros,
percentages and dates stay real numbers in Excel.

## Card payments (Stripe)

At checkout the customer picks **card** or **bank transfer**. The card option only shows once
`STRIPE_SECRET_KEY` is set and the `card-payment` function is running.

- **Placing a card order** takes the stock as usual, then opens Stripe Checkout (Stripe's own
  payment page, cards only, 31 minutes). The pieces are held until it expires. No bank-details
  email is sent for card orders.
- **Paid:** the order becomes `paid` and the "payment received" email goes out, as soon as the
  shop learns of it. That happens when the customer comes back (`/order/…?card=return`), when
  Stripe's webhook arrives (`stripe-webhook`), or at the check every two minutes (pg_cron →
  `card-payment` `sync`), whichever is first. All three ask Stripe directly, and recording a
  payment twice does nothing.
- **Not finished:** the order page offers "Pay by card" again (the old payment page is closed
  first, so there's never more than one) or "Pay by bank transfer instead" (usual deadline and
  the bank-details email). When the payment page expires unpaid, the order is cancelled, the
  stock goes back, and the customer gets "Your order … wasn't paid". A payment that somehow
  arrives after cancellation is refunded automatically.
- **Refunds:** in Admin → Returns, a card order's refund goes back to the card through Stripe
  (the amount is checked against what's left to refund). Cancelling a paid card order in the
  admin refunds it in full. Card orders can't be marked paid, refunded or cancelled by hand.
- **Where things are:** `supabase/functions/_shared/payments.ts` (plain fetch to Stripe's API),
  `card-payment` and `stripe-webhook` functions, migration `…230000_card_payments.sql`.

**Settings** go in `supabase/functions/.env`, which is not committed (`.env.example` lists the
names): `STRIPE_SECRET_KEY` (sk_test_… / sk_live_…), and optionally `STRIPE_WEBHOOK_SECRET`
(whsec_…). Restart Supabase after changing them. Nothing else is needed for test mode.

**Webhook:** Stripe can't reach a computer at home, so locally the webhook is optional (the
return visit and the two-minute check do the job). To try it, use the Stripe CLI:
`stripe listen --forward-to http://127.0.0.1:57321/functions/v1/stripe-webhook`. It prints a
`whsec_…` secret for `STRIPE_WEBHOOK_SECRET`. When live, add an endpoint in Stripe's dashboard at
`https://<your project>.supabase.co/functions/v1/stripe-webhook` with the events
`checkout.session.completed`, `checkout.session.async_payment_succeeded` and
`checkout.session.expired`, and use its signing secret.

## Customer accounts and returns

`/account` shows the customer's orders (placed while signed in) with status, pieces and
returns; `/account/addresses` holds up to 5 saved addresses, which checkout offers.

Returns: within `shop_settings.return_days` (14) of delivery, a customer ticks pieces and
gives a reason (`request_return()`). The owner approves (with a note, e.g. where to send it)
or refuses (a note is required) at `/admin/returns`, then marks it refunded when the pieces
are back — optionally putting them back in stock. Refunds themselves are paid by bank
transfer outside the shop.

- Shipping rates: `shipping_rates` table (price, countries it covers, parcel locker or not).
- Free-delivery threshold and **bank details**: the single row in `shop_settings`.
  The bank details are placeholders until replaced with the real account.

## Admin (`/admin`, owner only)

- **Dashboard** — sales by day (30 days) and month (12 months), orders, average order,
  refunds, best sellers (90 days), low stock (`shop_settings.low_stock_threshold`), and what's
  waiting. Figures come from `admin_dashboard()`; "sales" are paid orders, by order date,
  in Latvian time.
- **Orders** — search by number, name or email, filter by status; each order has its next
  step (paid, shipped with tracking, delivered, cancel) and its history.
- **Returns** — approve/refuse, then refund. Approved customers see `shop_settings.return_address`.
- **Products** — add and edit (`admin_save_product()`): text, price, photos (resized in the
  browser and uploaded to storage), colours, sizes and size prices, shown/hidden, featured,
  new. Renaming a colour or size keeps its stock.
- **Stock** — every colour × size of every product; typing a number saves it via
  `admin_set_stock()`, which refuses to overwrite a sale that happened meanwhile.
- **Customers** — accounts and guest buyers (by email), with their orders and addresses.

### Made-up history (for showing the shop)

`npm run demo:add` loads six months of made-up trading (`scripts/demo-history.mjs`):
about 400 customers and 2,000 orders (`NRD-07987`…`NRD-10000`, returns up to `RET-1000`),
returns, reviews, discount codes, newsletter sign-ups, contact messages, and a shelf
with a few pieces sold out or running low. Add `--dry` to see what it would load without
keeping it. It refuses to load twice.

- Every made-up person has an address at a reserved `.example` domain; no email is sent or
  even queued for them (the `emails_skip_demo` trigger), and nothing goes to Stripe (made-up
  card orders have no Stripe payment behind them, so they can't be refunded from the admin).
- Made-up accounts can't sign in.
- Stock, dashboard and reports agree with the made-up orders.

`npm run demo:remove` (or `select public.remove_demo_history()`) takes all of it out in one go:
orders, accounts, reviews, messages, sign-ups and the history's own codes. It puts the stock
back exactly as it was, keeping any real changes made since. Real orders and accounts are
never touched. Run it before opening.
