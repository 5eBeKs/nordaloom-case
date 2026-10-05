// Shared by the server functions. Plain TypeScript with fetch only (no Deno
// or Node APIs), so the same code runs in the edge runtime and in local tests.
import { renderEmail, type RenderedEmail } from "./emails/templates.ts"

export type Env = {
  /** The API as the functions reach it (inside the local setup: http://kong:8000). */
  supabaseUrl: string
  serviceKey: string
  /** The API as a browser or email program reaches it — used for product photos in emails. */
  publicSupabaseUrl: string
  /** Sender shown on every email, e.g. "Nordaloom <owner@nordaloom.example>". */
  from: string
  /** Local test mailbox (Mailpit) — every email lands there, none reach real people. */
  mailpitUrl?: string
  /** A real email service, for when the shop goes live. */
  resendApiKey?: string
  /** EMAIL_DEMO=1, the public demo only: nothing is sent; each email stays in the outbox as not sent. */
  demo?: boolean
}

/** The note an email gets in the outbox when the public demo doesn't send it (the admin shows "Not sent (demo)"). */
export const DEMO_NOT_SENT = "Demo shop: emails are not sent."

export function envFrom(get: (name: string) => string | undefined): Env {
  const need = (name: string) => {
    const v = get(name)
    if (!v) throw new Error(`Missing setting ${name}`)
    return v
  }
  const supabaseUrl = need("SUPABASE_URL")
  return {
    supabaseUrl,
    serviceKey: need("SUPABASE_SERVICE_ROLE_KEY"),
    publicSupabaseUrl: get("PUBLIC_SUPABASE_URL") || supabaseUrl,
    from: get("EMAIL_FROM") || "Nordaloom <owner@nordaloom.example>",
    mailpitUrl: get("MAILPIT_URL") || undefined,
    resendApiKey: get("RESEND_API_KEY") || undefined,
    ...(get("EMAIL_DEMO") === "1" ? { demo: true } : {}),
  }
}

// ---------------------------------------------------------------------------
// Database (as the service role)
// ---------------------------------------------------------------------------

async function rest(env: Env, path: string, init: RequestInit = {}) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`Database request ${path} failed: ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const rpc = (env: Env, fn: string, args: Record<string, unknown>) => rest(env, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) })

type Settings = { site_url: string; contact_email: string }
const settings = async (env: Env): Promise<Settings> => (await rest(env, "shop_settings?select=site_url,contact_email&limit=1"))[0]

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

type Outgoing = RenderedEmail & { to: string; toName?: string | null; replyTo?: string }

function parseAddress(s: string) {
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  return m ? { Name: m[1].replace(/^"|"$/g, ""), Email: m[2] } : { Name: "", Email: s.trim() }
}

/** Sends one email; returns the service's id for it. */
export async function sendMail(env: Env, m: Outgoing): Promise<string> {
  try {
    return await deliver(env, m)
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    // fetch() only says "fetch failed" when the service can't be reached at all.
    throw new Error(/fetch failed|ECONNREFUSED|network/i.test(msg) ? "Couldn't reach the mail service." : msg)
  }
}

async function deliver(env: Env, m: Outgoing): Promise<string> {
  if (env.resendApiKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.from,
        to: [m.toName ? `${m.toName.replace(/[<>"]/g, "")} <${m.to}>` : m.to],
        reply_to: m.replyTo,
        subject: m.subject,
        html: m.html,
        text: m.text,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Email service: ${res.status} ${body.message ?? ""}`.trim())
    return `resend:${body.id}`
  }
  if (env.mailpitUrl) {
    const res = await fetch(`${env.mailpitUrl}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: parseAddress(env.from),
        To: [{ Email: m.to, Name: m.toName ?? "" }],
        ReplyTo: m.replyTo ? [{ Email: m.replyTo }] : [],
        Subject: m.subject,
        HTML: m.html,
        Text: m.text,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Test mailbox: ${res.status} ${body.Error ?? ""}`.trim())
    return `mailpit:${body.ID}`
  }
  throw new Error("No email service is set up (MAILPIT_URL or RESEND_API_KEY).")
}

const imageUrlFor = (env: Env) => (path: string) =>
  /^https?:\/\//.test(path) ? path : `${env.publicSupabaseUrl}/storage/v1/object/public/product-images/${path.split("/").map(encodeURIComponent).join("/")}`

type QueuedEmail = { id: string; kind: string; to_email: string; to_name: string | null; data: unknown; attempts: number }

/** Sends everything waiting in the outbox. Safe to call any number of times at once. */
export async function processQueue(env: Env) {
  const { contact_email } = await settings(env)
  const ctx = { imageUrl: imageUrlFor(env) }
  let sent = 0
  let failed = 0
  let notSent = 0
  // A few batches per call; the next wake-up (or the minute job) takes the rest.
  for (let round = 0; round < 5; round++) {
    const batch: QueuedEmail[] = await rpc(env, "claim_emails", { p_limit: 20 })
    if (!batch.length) break
    for (const e of batch) {
      if (env.demo) {
        await markNotSentDemo(env, e.id)
        notSent++
        continue
      }
      try {
        const rendered = renderEmail(e.kind, e.data, ctx)
        const id = await sendMail(env, { ...rendered, to: e.to_email, toName: e.to_name, replyTo: contact_email })
        await rpc(env, "finish_email", { p_id: e.id, p_ok: true, p_provider_id: id, p_error: null })
        sent++
      } catch (err) {
        await rpc(env, "finish_email", { p_id: e.id, p_ok: false, p_provider_id: null, p_error: String((err as Error)?.message ?? err) })
        failed++
      }
    }
  }
  return env.demo ? { sent, failed, notSent } : { sent, failed }
}

/** EMAIL_DEMO: a claimed email is kept as "not sent" (status skipped), with the demo note instead of an error. */
async function markNotSentDemo(env: Env, id: string) {
  await rest(env, `emails?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "skipped", error: DEMO_NOT_SENT, claimed_at: null, next_attempt_at: null }),
  })
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
/** Matches auth.email.otp_expiry in supabase/config.toml. */
const LINK_MINUTES = 60

/**
 * Sends a reset link if there's an account for this address. Always answers
 * the same way, so nobody can find out which addresses have accounts.
 */
export async function requestPasswordReset(env: Env, rawEmail: unknown) {
  const email = String(rawEmail ?? "").trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 320) return { ok: false as const, error: "invalid_email" }

  if ((await rpc(env, "recent_password_resets", { p_email: email })) >= 3) return { ok: true as const }

  const res = await fetch(`${env.supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "recovery", email }),
  })
  if (!res.ok) return { ok: true as const } // no such account (or auth refused): say nothing
  const user = await res.json()
  const hashed: string | undefined = user.hashed_token ?? user.properties?.hashed_token
  if (!hashed) return { ok: true as const }

  const { site_url, contact_email } = await settings(env)
  const fullName: string = user.user_metadata?.full_name ?? user.user?.user_metadata?.full_name ?? ""
  const data = {
    email,
    first_name: fullName.trim().split(/\s+/)[0] || null,
    link: `${site_url}/reset-password?token_hash=${encodeURIComponent(hashed)}&type=recovery`,
    expires_minutes: LINK_MINUTES,
    site_url,
    contact_email,
  }
  if (env.demo) {
    // EMAIL_DEMO: not sent; the copy in the admin (without the link, as always) says so.
    await rest(env, "emails", {
      method: "POST",
      body: JSON.stringify({ kind: "password_reset", to_email: email, data: { ...data, link: null }, status: "skipped", error: DEMO_NOT_SENT, attempts: 0, dedupe_key: `password_reset:${crypto.randomUUID()}` }),
    })
    return { ok: true as const }
  }
  let providerId: string | null = null
  let error: string | null = null
  try {
    providerId = await sendMail(env, { ...renderEmail("password_reset", data, { imageUrl: imageUrlFor(env) }), to: email, toName: fullName || null, replyTo: contact_email })
  } catch (err) {
    error = String((err as Error)?.message ?? err)
  }
  // The copy kept in the admin leaves out the link, which would let anyone reading it into the account.
  await rpc(env, "log_email", { p_kind: "password_reset", p_to: email, p_data: { ...data, link: null }, p_ok: !error, p_provider_id: providerId, p_error: error })
  return { ok: true as const }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })
