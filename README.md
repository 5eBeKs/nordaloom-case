# Nordaloom: a shop built with Claude Code, then checked and fixed

A knitwear shop, fictional and holding test data only, built with Claude Code from 17
plain-language messages, the way someone who does not read code would build it. It looked
finished and worked in a normal walk-through. Then it was checked, and fixed until a review of
the last fix found nothing above low.

**Sample engagement:** the shop is fictional and holds test data; it was built with Claude Code
for this case; every finding, test and fix is a real run. Shown as a sample of work, not
licensed for reuse.

## What is here

| Folder or file | What it is |
| --- | --- |
| `as-built/` | The shop exactly as Claude Code handed it over after the 17th message: React, TypeScript, Vite, Tailwind, shadcn/ui, Supabase, Stripe Checkout. |
| `fixed/` | The same shop after the check and the fixes, with its tests. Its README says how to run it, what was changed and what was left as it is. |
| `BUILD-LOG.md`, `messages/` | Every message to the builder and every answer, word for word (two things taken out, marked). The build took 215 minutes of the builder's work. |
| `report/FINDINGS.json` | The findings in the shop as received, each with an example, the test that shows it and the fix, with pictures before and after. |
| `evidence/` | The test runs on the shop as received and after the fixes. |

To see everything that was changed: `git diff --no-index as-built fixed`.

## What was found

In the shop as received: **28 defects** — 1 critical, 3 high, 10 medium, 14 low. 24 are fixed,
4 are left to the owner with the reason.

- **Critical:** any signed-in account could open any order placed without an account by its
  number, with the customer's name, email, phone and address.
- **High:** after a dropped connection, a customer could be shown another customer's order
  and address; the owner could record a refund of any size; a customer could pay by card for
  an order the shop had already cancelled, and not get the money back.

Of the 51 tests run on the shop as received, 42 failed there. All 105 tests pass now.

What held: nobody without an account could read customers' data, prices and stock are decided
by the database, the totals of all 2,059 orders add up to the cent, and forged payment notices
are refused.

## Live

The fixed shop runs at **https://nordaloom.ilyashkura.com** as a demo: the two demo logins
(a customer and the owner) are on its sign-in page, payments use Stripe's test card, no email
is sent, the owner can run orders but not change what the shop shows, and everything is put
back every night. The live shop was checked again after going live (`report/FINDINGS.json`,
"after going live"): nothing above medium, and the one medium (the plain http address) and
the lows were fixed the same day.

## Limits

One shop, built once. Stripe in test mode only. Installing on a real phone was not tried.
