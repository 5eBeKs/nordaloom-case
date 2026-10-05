// The public demo of the shop is built with VITE_DEMO=1 (see live/build-web.mjs). Without it, none of
// this shows and the shop behaves as before.
export const DEMO = import.meta.env.VITE_DEMO === "1"

export type DemoLogin = { label: string; email: string; password: string }

/** The demo's published logins, given to the build as JSON in VITE_DEMO_LOGINS. */
export const DEMO_LOGINS: DemoLogin[] = DEMO ? parseLogins(import.meta.env.VITE_DEMO_LOGINS) : []

function parseLogins(raw: unknown): DemoLogin[] {
  try {
    const list = JSON.parse(String(raw ?? "[]"))
    return Array.isArray(list) ? list.filter((l) => l && typeof l.email === "string" && typeof l.password === "string") : []
  } catch {
    return []
  }
}

/** Matches DEMO_NOT_SENT in supabase/functions/_shared/server.ts: the outbox note of an email the demo didn't send. */
export const DEMO_NOT_SENT = "Demo shop: emails are not sent."

// On the demo the database refuses changes to the storefront (live/sql/…_live_demo_storefront_read_only.sql):
// "permission denied" (42501). The admin says so in one plain line instead of "That didn't work".
// (Each behind DEMO, so a build without VITE_DEMO carries none of these words.)
export const DEMO_OFF = DEMO ? "demo_off" : "" // never returned without VITE_DEMO (demoRefused is false)
export const DEMO_CATALOGUE_OFF = DEMO ? "Changes to the catalogue are off in the demo." : ""
export const DEMO_REVIEWS_OFF = DEMO ? "Publishing and answering reviews is off in the demo." : ""
export const demoRefused = (error: unknown) => DEMO && (error as { code?: string } | null)?.code === "42501"

/** Under the checkout and the contact form. */
export const DEMO_DETAILS_NOTE = "Use made-up details: anyone with the demo owner login can see orders and messages until the nightly reset."
/** On the sign-in page and the checkout (live/sql/…_live_demo_reset.sql, live_demo_tidy). */
export const DEMO_ORDERS_NOTE = "Unpaid demo orders are cancelled after 30 minutes; stock refills every 15 minutes."
