# Checks

Three sets, all against the local Supabase the shop uses (`.env.local`). They place orders, sign
customers up and move stock, so they refuse to run against anything that is not on this machine.
Run them on a scratch copy of the shop's data, not on a shop with real orders.

| Command | What runs | Needs |
| --- | --- | --- |
| `npm test` | `tests/api`: the database functions and the payment code, through the same API the shop uses (Vitest) | local Supabase running |
| `npm run test:browser` | `tests/browser`: the shop and the admin in a real browser (Playwright) | the dev server (started if it isn't running) |
| `npm run test:app` | `tests/pwa`: the production build as an installed app, online and offline (Playwright) | builds the shop first |

Settings, all optional:

- `SHOP_URL` (default `http://localhost:3300`) and `APP_URL` (default `http://localhost:4300`): where the dev
  server and the built shop are served.
- `PW_CHANNEL` (default `msedge`): the browser Playwright drives.
- `TEST_ACCOUNTS` (default `../test-accounts.local`): a file with `owner_email=` and `owner_password=` of
  the owner account of this local shop. It is not in the repository.
- `TEST_SERVICE_KEY`: the local service key. Left out, it is read from `npx supabase status`.
- `SHOTS_DIR`: a folder for pictures of the screen at the moments the report shows.

What they need from the shop: some pieces with 8 or more in stock (12 for one check), and, for the three checks
about the made-up history, the history loaded (`npm run demo:add`); without it those three are skipped.

Test customers and orders use addresses at `example.test`, which cannot receive mail. Unpaid test orders are
cancelled, and their pieces put back, before and after each run; newsletter sign-ups at `example.test` are
removed. A run places more orders without an account than the shop takes in an hour, so the two shop-wide limits
on those (`guest_bank_orders_waiting`, `guest_orders_per_hour`) are lifted while it runs and put back when it
ends; the checks of those limits set their own numbers. A run stopped half-way can leave them lifted; the next
run that finds them so puts the shop's defaults back when it ends (15 and 20, and 20 for
`newsletter_signups_per_hour`).

## Card payments without Stripe

`tests/api/card.test.ts` runs the shop's own payment code (`supabase/functions/_shared/payments.ts`) against
the local database and `tests/api/stripe-stand-in.ts`, a small server that answers like Stripe's API for the
calls the shop makes: a payment page can be open, paid or expired, and a refund can be made to fail. No Stripe
key is needed and no money moves. What this does not show is Stripe's real behaviour; the case of an order
cancelled while its payment page is open was also run once in a browser against Stripe in test mode.

## The installed app

`tests/pwa/version.spec.ts` builds the shop twice (the second time with one line changed), serves the first
build, then swaps in the second while a browser still has the first open. `tests/pwa/offline.spec.ts` uses the
build served by `vite preview`, which answers with `Vary: Origin`, as some hosts do.

Not covered: installing on a real phone, the install prompt, and iPhone.
