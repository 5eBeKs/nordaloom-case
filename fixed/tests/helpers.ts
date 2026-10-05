// Shared by the checks: the local Supabase the shop uses, the owner, throwaway customers, orders.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'

function kv(file: string): Record<string, string> {
  // relative to the app folder, where both test runners start
  return Object.fromEntries(
    readFileSync(resolve(process.cwd(), file), 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  )
}
const env = kv(process.env.TEST_ENV_FILE ?? '.env.local')
const accounts = kv(process.env.TEST_ACCOUNTS ?? '../test-accounts.local')
export const URL_ = env.VITE_SUPABASE_URL!
export const KEY = env.VITE_SUPABASE_ANON_KEY!
// The checks place orders, sign people up and move stock: only ever against a copy on this machine.
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_)) throw new Error(`The checks only run against a local copy of the shop, not ${URL_}`)
// the local database sits one port above the API
export const DB = `postgresql://postgres:postgres@127.0.0.1:${Number(new URL(URL_).port) + 1}/postgres`
export const MAILBOX = `http://127.0.0.1:${Number(new URL(URL_).port) + 3}`

export const visitor = (): SupabaseClient => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })

export interface User { sb: SupabaseClient; id: string; email: string; password: string }

export async function customer(tag = 'check'): Promise<User> {
  const sb = visitor()
  const email = `${tag}-${crypto.randomUUID().slice(0, 12)}@example.test`
  const password = `pw-${crypto.randomUUID()}`
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: `Test ${tag}` } } })
  if (error || !data.user) throw error ?? new Error('no user')
  return { sb, id: data.user.id, email, password }
}

export async function owner(): Promise<User> {
  const sb = visitor()
  const { data, error } = await sb.auth.signInWithPassword({ email: accounts.owner_email!, password: accounts.owner_password! })
  if (error || !data.user) throw error ?? new Error('owner sign-in failed')
  return { sb, id: data.user.id, email: accounts.owner_email!, password: accounts.owner_password! }
}

export function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

export async function sql<T = Record<string, unknown>>(query: string, args: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: DB })
  await db.connect()
  try { return (await db.query(query, args)).rows as T[] } finally { await db.end() }
}

export interface Piece { id: string; price: number; name: string; stock: number }
/** Pieces on sale with plenty in stock, the cheapest first (so orders stay under the free-delivery line). */
export async function pieces(n = 1, minStock = 8): Promise<Piece[]> {
  const rows = await sql<Piece>(
    `select v.id, coalesce(v.price_cents, p.price_cents) as price, p.name, v.stock
       from public.product_variants v join public.products p on p.id = v.product_id
      where p.is_published and v.stock >= $1
      order by coalesce(v.price_cents, p.price_cents), v.id limit $2`, [minStock, n])
  if (rows.length < n) throw new Error('not enough pieces in stock')
  return rows
}

export const person = (email: string, name = 'Test Person') => ({
  email, full_name: name, phone: '+371 20000000', country: 'LV',
  address_line1: 'Brivibas iela 1', address_line2: '', city: 'Riga', postal_code: 'LV-1010',
})

export interface Placed { order_number: string; access_token: string; already_placed?: boolean }
/** Places an order by bank transfer with the courier in Latvia (5.99), as the checkout does. */
export function placeOrder(sb: SupabaseClient, email: string, items: { variant_id: string; quantity: number }[], extra: Record<string, unknown> = {}) {
  return sb.rpc('place_order', { items, customer: person(email), shipping_code: 'courier_lv', parcel_locker: '', ...extra })
}

export const orderRow = async (orderNumber: string) =>
  (await sql<{ id: string; status: string; total_cents: number; refunded_cents: number; email: string; shipping_cents: number }>(
    'select id, status, total_cents, refunded_cents, email, shipping_cents from public.orders where order_number = $1', [orderNumber]))[0]!

/** The owner takes an order through paid, shipped and delivered. */
export async function deliver(o: User, orderNumber: string) {
  const { id } = await orderRow(orderNumber)
  for (const status of ['paid', 'shipped', 'delivered']) must(await o.sb.rpc('set_order_status', { p_order_id: id, p_status: status, p_tracking: 'CHECK-1' }))
  return id
}

/** A customer's delivered order of the given pieces, and an approved return of all of them. */
export async function approvedReturn(o: User, c: User, items: { variant_id: string; quantity: number }[]) {
  const placed = must(await placeOrder(c.sb, c.email, items)) as Placed
  const orderId = await deliver(o, placed.order_number)
  const lines = await sql<{ id: string; quantity: number }>('select id, quantity from public.order_items where order_id = $1', [orderId])
  const returnNumber = must(await c.sb.rpc('request_return', {
    p_order_number: placed.order_number, p_items: lines.map((l) => ({ order_item_id: l.id, quantity: l.quantity })), p_reason: 'changed_mind',
  })) as string
  const [{ id: returnId }] = await sql<{ id: string }>('select id from public.returns where return_number = $1', [returnNumber])
  must(await o.sb.rpc('update_return', { p_return_id: returnId, p_action: 'approve', p_note: 'check' }))
  return { orderNumber: placed.order_number, orderId, returnId }
}

/**
 * Cancels the unpaid orders the checks (and earlier test visits) left, putting their pieces back, so the next check
 * starts with nothing held. Test orders are the ones to addresses at example.test, which cannot receive mail.
 */
export async function cancelTestOrders() {
  const db = new pg.Client({ connectionString: DB })
  await db.connect()
  try {
    await db.query('begin')
    // no emails for these
    await db.query('set local session_replication_role = replica')
    await db.query(`create temporary table _gone on commit drop as
      select id from public.orders where status = 'awaiting_payment' and email like '%@example.test' for update`)
    await db.query(`update public.product_variants v set stock = v.stock + i.q
      from (select variant_id, sum(quantity) as q from public.order_items where order_id in (select id from _gone) group by 1) i
      where i.variant_id = v.id`)
    const { rowCount } = await db.query(`update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'by_shop' where id in (select id from _gone)`)
    // and the limit per visitor forgets them (every check comes from the same local address)
    if ((await db.query("select to_regclass('public.order_origins') as t")).rows[0].t) {
      await db.query(`delete from public.order_origins where order_id in (select id from public.orders where email like '%@example.test')`)
    }
    await db.query('commit')
    return rowCount ?? 0
  } catch (e) {
    await db.query('rollback')
    throw e
  } finally {
    await db.end()
  }
}

/**
 * Switches the limit per visitor on for a check (locally one proxy stands in front of the API) and gives back a
 * function that puts the setting back as it was.
 */
export async function visitorLimitOn() {
  const [{ proxy_hops: before }] = await sql<{ proxy_hops: number }>("select proxy_hops from public.shop_settings")
  await sql("update public.shop_settings set proxy_hops = 1")
  return () => sql("update public.shop_settings set proxy_hops = $1", [before])
}

/** What a run lifts the shop-wide limits to (see guestLimitsLifted), and what they are in a shop. */
const LIFTED = 100_000
const LIMIT_DEFAULTS: Record<string, number> = { guest_bank_orders_waiting: 15, guest_orders_per_hour: 20, newsletter_signups_per_hour: 20 }
// set by guestLimitsLifted in the run's setup; the checks inherit it
const RUN_LIFTED = "NORDALOOM_CHECKS_LIFTED_LIMITS"

/**
 * Sets one of the shop's settings for a check and gives back a function that puts it back as it was. A limit found
 * at the lifted value outside a run that lifted it was left so by a run stopped half-way: it goes back to the
 * shop's default instead.
 */
export async function setting(column: string, value: number) {
  if (!/^[a-z_]+$/.test(column)) throw new Error(`not a settings column: ${column}`)
  const [{ found }] = await sql<{ found: number }>(`select ${column} as found from public.shop_settings`)
  const before = found === LIFTED && column in LIMIT_DEFAULTS && !process.env[RUN_LIFTED] ? LIMIT_DEFAULTS[column] : found
  await sql(`update public.shop_settings set ${column} = $1`, [value])
  return () => sql(`update public.shop_settings set ${column} = $1`, [before])
}

/**
 * The shop-wide limits on orders without an account count every such order of the last hour, the checks' own
 * cancelled ones too, and one run places more of them than the shop takes in an hour. A run lifts them, and puts
 * them back as they were when it ends (to the shop's defaults, if an earlier run stopped half-way left them
 * lifted); the checks of those limits set their own numbers.
 */
export async function guestLimitsLifted() {
  const columns = ["guest_bank_orders_waiting", "guest_orders_per_hour"]
  const there = await sql<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'shop_settings' and column_name = any($1)", [columns])
  const restore: (() => Promise<unknown>)[] = []
  for (const { column_name } of there) restore.push(await setting(column_name, LIFTED))
  process.env[RUN_LIFTED] = "1"
  return async () => {
    delete process.env[RUN_LIFTED]
    for (const r of restore) await r()
  }
}

/** Newsletter sign-ups the checks made (addresses at example.test), with what is kept about where they came from. */
export async function forgetTestSignups() {
  await sql("delete from public.newsletter_subscribers where email like '%@example.test'")
}

/** Emails the shop has queued or sent for an order, by kind. */
export const emailsFor = async (orderNumber: string) =>
  (await sql<{ kind: string }>('select e.kind from public.emails e join public.orders o on o.id = e.order_id where o.order_number = $1 order by e.created_at', [orderNumber])).map((r) => r.kind)

/** The shelf as it is now, to be put back after a run: the checks' own orders must not wear the stock down. */
export async function shelf() {
  return { at: new Date(Date.now() - 5000), stock: new Map((await sql<{ id: string; stock: number }>('select id, stock from public.product_variants')).map((r) => [r.id, r.stock])) }
}

/** Puts back the stock of every piece the checks ordered since `before` was taken. */
export async function putShelfBack(before: Awaited<ReturnType<typeof shelf>>) {
  const touched = await sql<{ id: string }>(
    `select distinct i.variant_id as id from public.order_items i join public.orders o on o.id = i.order_id
     where o.email like '%@example.test' and o.created_at >= $1 and i.variant_id is not null`, [before.at])
  for (const { id } of touched) {
    if (before.stock.has(id)) await sql('update public.product_variants set stock = $2 where id = $1', [id, before.stock.get(id)])
  }
}
