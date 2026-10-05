# Nordaloom shop

React + TypeScript + Vite + Tailwind + shadcn/ui, on Supabase.

## Running

```sh
npm install
npm run dev -- --port 3300
```

Supabase connection details live in `.env.local` (local project: API on `127.0.0.1:57321`).

On a local copy, switch the limit on unpaid orders per visitor on once (it is off until told how
many proxies stand in front of the API; locally that is one):
`update public.shop_settings set proxy_hops = 1;`

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

Twelve emails; their templates are in `supabase/functions/_shared/emails/` (plain TypeScript,
shared by the server functions that send them and by the admin, which previews them; the shop
imports them as `@emails/…`): order confirmation with bank details, payment reminder (two days
before the deadline), order cancelled (when an unpaid order passes its deadline, and when the
owner cancels an order: the email says which, and what happens to any money), payment received,
payment returned (a card payment that arrived for an order already cancelled), shipped (with
tracking), delivered, return approved,
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
  - a built shop opens with the page it was installed with, at every address of the app (a
    file's address, like `robots.txt`, gets the file); on the dev server pages come from the
    network first, with the last copy used offline;
  - fingerprinted build files come from the cache;
  - product photos come from the cache and are refreshed in the background (at most 400);
  - data is never cached there.
  Every build is a new version: the build fills in `VERSION` and the list of the build's
  files (`vite.config.ts`), the phone saves the whole new build when it notices it, drops the
  old one, and open apps show "A new version of the shop is ready — Refresh". A new version
  installs only when the host already serves its page (every script and stylesheet the page
  names must be in the build's list), so a deploy caught half-way waits instead of mixing two
  builds. The first start after a deploy still runs the old version, and the message follows a
  few seconds later. Saved copies are matched by address alone, so a host that answers with
  `Vary: Origin` doesn't break offline use, and a page reached through a redirect is saved as
  a plain page.
- **What customers have seen is kept on the device** (`src/lib/offline.ts`, TanStack Query
  persisted to localStorage for 14 days): categories, products, the bag's pieces, shipping and
  settings, the account's orders, order pages, addresses and reviews. Admin data is never kept.
  A customer's own data is forgotten when they sign out (or the sign-in runs out): the saved
  pages, the copies of their bag and wish list, and the links back into their orders.
- **Bag and wish list offline:** signed-in customers' bag and wish list also live on the device.
  A change made offline is kept as that change and sent when the connection returns; then
  the account's bag or list is read again, so what other devices did meanwhile shows up.
- **Offline or not** (`src/lib/connection.ts`): the phone's own flag, plus whether requests to the
  shop actually get through. That covers trains and café logins, which report "online". While
  offline, a bar says so and queries wait instead of failing.
- **Ordering once:** checkout sends a random key with each attempt (kept for 12 hours). The
  database returns the existing order if the same key arrives again within a day, so a double
  tap or a retry of the same order after a dropped connection never makes two orders (a
  changed order is a new one: see "Checks, and what they changed"). Offline, the checkout keeps
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
  shop learns of it. That happens when the customer comes back (`/order/…?card=return`: an order
  placed while signed in opens there by signing in, a guest's by the key in the address), when
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
  admin refunds it in full. Card orders can't be marked paid or refunded by hand, and are cancelled by hand only when
  Stripe cannot be asked and the order's deadline has passed.
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
- The history's discount codes are created paused: they are there for its orders to point at,
  and no real customer can use one.

`npm run demo:remove` (or `select public.remove_demo_history()`) takes all of it out in one go:
orders, accounts, reviews, messages, sign-ups and the history's own codes (a code that a real
order has used meanwhile stays, paused). It puts the stock
back exactly as it was, keeping any real changes made since. Real orders and accounts are
never touched. Run it before opening.

## Checks, and what they changed

`tests/` holds the checks that were written after the shop was reviewed; how to run them is in
`tests/README.md`. What was changed because of them, over four rounds (database side in
`supabase/migrations/`: `…239000_after_the_check.sql`, `…239500_after_the_fix_review.sql`,
`…239800_after_the_second_review.sql`, `…239900_after_the_third_review.sql`), and before going
live (the limits for the whole shop, the newsletter and the card return:
`20261005120000_before_going_live.sql`):

- **Who may open an order.** `get_order()` opened any order placed without an account for
  any signed-in account that knew or guessed its number: "refuse unless the account matches"
  does not refuse when the order has no account. Each of its three tests (the link, the
  account, the owner) is now either true or it isn't, and the page's data no longer carries
  the keys that make or find orders.

- **The same order sent again.** The key that stops a double order now stands for one exact
  order by one person. After a lost answer, a different bag or a different person on the same
  device gets a new order; before, they were shown the earlier person's order. A changed
  order after a lost answer (another address, another email, another bag, signed in meanwhile)
  would be a second order if the first went through, so the checkout first asks the shop
  (`earlier_attempt()`, with the email address the attempt was sent with) and says so before
  anything more is ordered: someone ordering with that same address is shown the earlier
  order; anyone else only that an earlier attempt from this device went through. Pressing
  again is their decision. It can only do that on the device the attempt was made on, within
  12 hours; what it keeps meanwhile is the email address and a fingerprint of what was sent. A cancelled
  order is never handed back as "already placed", and `items: null` is refused.
- **The amount agreed to.** The checkout sends the total on its button; `place_order()` refuses
  (`price_changed`) if its own total differs, and the page shows the new total and asks again.
- **Unpaid orders are limited** (`too_many_unpaid`, `too_many_orders`, `too_many_guest_orders`,
  `order_too_large`):
  - an order holds at most 40 pieces;
  - three orders waiting for a bank transfer per email address (`name+tag@` counts as
    `name@`), also when a card order is switched to bank transfer. A signed-in customer
    ordering to their own address is not held to this, and neither is an order paid by card.
    So a customer with an account cannot be stopped by someone typing their address into
    unpaid orders; a guest paying by bank transfer still can be, until those orders are paid
    or cancelled, and is told to pay by card or sign in;
  - five unpaid orders per account;
  - per visitor, **once switched on**: at most eight orders from one network address that are
    unpaid, or were cancelled unpaid in the last day, signed in or not. The address is read
    from `X-Forwarded-For`; `shop_settings.proxy_hops` says how many proxies in front of the
    API to trust, and 0 (the default) switches this limit off (the limits for the whole shop,
    below, still hold). **Set it on the host the shop
    goes live on, after looking at what the header holds there**: a wrong number makes every
    visitor look like the same one, and honest customers would be refused. Even with the
    right number, people behind one shared address (an office, a mobile carrier) share the
    eight. The address itself is not stored: a hash made with the shop's own secret is kept
    in `order_origins`, which the API does not serve, and removed once the order is no longer
    unpaid and a day old.
  - for orders placed without an account, in the whole shop, whatever `proxy_hops` says (so
    also while the limit per visitor is off): at most 15 waiting for a bank transfer at once
    (`shop_settings.guest_bank_orders_waiting`; a card order switched to bank transfer counts
    too), and at most 20 placed in the last hour that are unpaid or were cancelled unpaid, by
    card or bank transfer (`shop_settings.guest_orders_per_hour`). Orders of the made-up history
    are not counted. Over the first, the guest is told that lots of orders are coming in and
    asked to pay by card, or to sign in or create an account (orders waiting for a transfer stay
    until they are paid or their payment days run out, so waiting an hour does not help); over
    the second, to sign in or create an account, or to try again in an hour. A signed-in customer
    is never held to these. **That only holds while making an account costs something**: email
    confirmation switched on at the host (it is off in `supabase/config.toml`), sign-ups closed,
    or a CAPTCHA on signing up. Without one of those, a script makes an account in a moment and
    orders around these limits. The flip side: while someone is placing unpaid orders without
    an account, honest guests are turned away too, and have to sign in, pay by card or wait.
  These limits slow abuse down; they do not end it. A CAPTCHA on guest checkout and a rate
  limit at the host are the next step if unpaid orders are abused. Visitors cannot read the
  settings these limits use.
- **Newsletter sign-ups** go through `subscribe_newsletter()`; the list can no longer be
  written to directly (every new address gets the welcome email with the welcome code, so a
  script could make the shop email any number of strangers). The same mailbox again, in any
  letter case or with any `+tag` (`name+1@` is `name@`), is "already on the list" and gets
  nothing more; the address is kept without the tag. At most 20 new sign-ups in the
  last hour in the whole shop (`shop_settings.newsletter_signups_per_hour`) and, once the limit
  per visitor is switched on (`proxy_hops`), three a day per visitor (only a hash of the address,
  in `newsletter_origins`, which the API does not serve, for a day). Over the first, the form
  says "We're getting a lot of sign-ups right now. Please try again in an hour."; over the
  second, to try again tomorrow. Like the limits on orders, this slows abuse down: someone who
  keeps at it can still use up the hour's sign-ups, and honest visitors then wait.
- **Coming back from a card payment.** Stripe sends the customer back to the order's page. For an
  order placed while signed in, that address no longer carries the order's key: it stays in the
  browser's history, and anyone on the same device could open the order from there (name,
  street, email, phone) after the customer signed out. The page opens such an order through the
  sign-in; someone who comes back signed out is asked to sign in and sees nothing of the order,
  and signing in brings them back to it. The links in the order's emails are the same. A
  guest's return address and email links keep the key: it is their only way back to the order.
- **Refunds** recorded against a return cannot exceed what is left of what the customer paid
  (`refund_too_large`), and delivery is suggested only with the return that completes the order.
- **Cancelling a card order** goes through the `card-payment` function, which asks Stripe
  first. Not paid: the order is cancelled only after Stripe has confirmed that its payment
  page is closed; if Stripe does not close it, the order is left as it is and the owner is
  asked to try again (the same holds for switching an order to bank transfer). Paid without
  the shop having heard: the money goes back. Only when Stripe cannot be asked at all and
  the order's deadline has passed is the order cancelled without it, and such an order
  cancels itself six hours past its deadline. A payment that turns out to have been made on
  a cancelled order is refunded: on Stripe's notice, by the two-minute check (orders
  cancelled in the last three days), or when the customer opens the order; again each time
  until the refund has gone through. The customer gets a "payment returned" email. A second
  payment for an order that is already paid goes back too (it is logged, not shown in the
  admin).
- **Every cancellation is emailed**, including one by the shop ("please don't send the payment").
- **Settings.** Visitors can read only the columns the shop pages show; the owner's pages use
  `admin_settings()`.
- **Dates** are shown in Latvian time on every device, the same as in the emails.
- **Signing out** leaves nothing of the customer's in the browser: the saved pages, the copies
  of the bag and wish list, the pieces that were in the bag, the links into orders, also when a
  sync is still on its way at that moment. (A guest's
  remembered order link goes too when someone signs out on the device; the emailed link
  still works.)
- **The bag and wish list offline.** The bag lists and prices every piece from what the device
  has saved. A change made without a connection is kept as that change ("two of this piece",
  "this one taken out") and only those changes are sent when the connection is back, so what
  another device did to the bag or the list meanwhile stays. A piece changed on both devices
  ends at the quantity sent last. A change to a piece the shop no longer sells is dropped,
  and the rest are sent.
- **The installed app.** Every build is a new version with its own list of files; the page a
  version opens with is the one it was installed with, at every address, so the page and
  the files are always the same build, whatever the host or the browser has cached.
- **A return with nothing left to refund** can be closed with nothing, and the email says so;
  while money is left, a refund of nothing is refused.

Left as it is, on purpose:

- A bank transfer that arrives after the order cancelled itself cannot be recorded against
  it: whether to reinstate the order or send the money back is the owner's call each time.
- The dashboard's "refunded, last 30 days" counts 30 × 24 hours back, the reports count
  calendar days; and the "never paid" block counts orders that were paid and later cancelled
  as paid. The figures are right, the labels differ.
- Whether an email address has ordered before can be learnt from a first-order code or from
  signing up with it. Closing this means changing how first-order codes are offered.
- Email confirmation is off (`supabase/config.toml`): on a brand-new database, whoever signs
  up first with the owner address becomes the owner. Create the owner account before opening.
- The list of files in the public photo bucket can be read by anyone; the photos are public.
- The customer page counts pieces that were returned under "Pieces bought".
- The email preview in the admin shows one version of "Order cancelled" (not paid in time);
  the versions sent when the shop cancels can only be seen in the outbox.
- A piece added to the bag in the moment before the account's bag has loaded on a new device
  is saved with the quantity on screen, not added to what the account already has of it.
- The two-minute check of card payments can be called by anyone: it takes no input and only
  asks Stripe about the shop's own card orders, the open ones and those cancelled in the last
  three days with a payment page on record. An order it can never clear (a payment on a
  cancelled order whose refund Stripe keeps refusing, say, because it was refunded by hand at
  Stripe) is asked about on every check for those three days, and on every visit to its page.
- A card order is accepted even when card payments are not set up: the database can't tell
  whether the card function has a key. Such an order holds its pieces for 40 minutes and
  cancels itself; the page only offers card payment when the function says it is set up.
- A card order whose payment page is being replaced (the customer pressed "pay" again, or
  asked to switch to bank transfer and was refused) holds its pieces until its deadline, up to
  45 minutes; a refused switch has already closed the page, and the customer pays by card again.
- A change to the bag that fails while online is sent again at the next reconnect or the next
  start of the shop, not by itself; offline changes not yet sent are dropped at sign-out.
- The newsletter keeps and emails an address without its `+tag`, so the welcome goes to the
  address without the tag, and the admin's Newsletter flag says "Not subscribed" for an account
  whose address has a tag.
- For an hour after `npm run demo:add`, the hourly newsletter limit counts the made-up history's
  own sign-ups.
- A test run stopped inside a check that lowered a limit can leave that limit low: put the
  defaults back by hand (`newsletter_signups_per_hour` 20, `guest_bank_orders_waiting` 15,
  `guest_orders_per_hour` 20).
- The emailed link of an order placed with an account opens only for that account, also when
  the order was sent to a different address.

Found by the last review, all low, and not fixed:

- If the check for pieces no longer sold fails while offline bag or wish-list changes are being
  sent, the other changes can be dropped instead of kept.
- A customer who corrects a mistyped email after a lost answer is told an earlier attempt went
  through, but gets nothing to act on (no number, no way to cancel it from the device).
- The installed app treats any address ending in ".something" as a file, so the owner's
  customer pages (`/admin/customers/<email>`) don't open on a reload or offline there.
- Closing a return without a refund keeps "Put back in stock" ticked, which is wrong for a
  parcel that never came back; its email quotes the note written when the return was
  approved; the badge still reads "Refunded".
- Some of the owner's messages after a failed card cancel name the wrong cause.
- An attempt saved on a device in the 12 hours before this version was deployed is taken as
  "changed".
- A signed-in customer who lost an answer, signed out and ordered as a guest is not warned; a
  gift ordered to another address is not named after a reload.
- A change to a piece whose product is only hidden (not deleted) is still saved to the account.

- The delivery address is checked for being filled in, not for what it says: a street of
  digits only is accepted, as in most shops; the delivery company catches a wrong address.
  The postal code accepts letters on purpose: the shop delivers across the EU, where many
  codes have them (Latvia `LV-1050`, the Netherlands `1012 AB`, Ireland `D02 X285`, Malta
  `VLT 1117`). Checking each country's format is a possible improvement, not a fault.
