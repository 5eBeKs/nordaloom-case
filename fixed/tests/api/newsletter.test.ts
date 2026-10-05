// Signing up for the newsletter: one welcome email per address, and only so many new sign-ups at a time, so a
// script cannot make the shop email any number of strangers.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest"
import pg from "pg"
import { customer, DB, forgetTestSignups, must, owner, setting, sql, visitor, visitorLimitOn, type User } from "../helpers"

let o: User
beforeAll(async () => {
  o = await owner()
})
// each check starts with none of the checks' own sign-ups (the limits below count them)
beforeEach(forgetTestSignups)
afterAll(forgetTestSignups)

const address = (tag: string) => `${tag}-${crypto.randomUUID().slice(0, 10)}@example.test`
const subscribe = (email: string, sb = visitor()) => sb.rpc("subscribe_newsletter", { p_email: email })
/** Welcome emails the shop has queued or sent to an address. */
const welcomes = async (email: string) =>
  (await sql<{ n: number }>("select count(*)::int as n from public.emails where kind = 'newsletter_welcome' and lower(to_email) = lower($1)", [email]))[0].n
const onList = async (email: string) =>
  (await sql<{ n: number }>("select count(*)::int as n from public.newsletter_subscribers where lower(email) = lower($1)", [email]))[0].n
const demoSignups = (await sql<{ n: number }>(
  "select count(*)::int as n from public.newsletter_subscribers where lower(email) in (select email from public.demo_people)"))[0].n
/** New sign-ups in the last hour, as the shop-wide limit counts them. */
const lastHour = async () =>
  (await sql<{ n: number }>("select count(*)::int as n from public.newsletter_subscribers where created_at > now() - interval '1 hour'"))[0].n

describe("signing up", () => {
  test("an address can no longer be put on the list directly, past the limits", async () => {
    const email = address("direct")
    const { error } = await visitor().from("newsletter_subscribers").insert({ email })
    // as built: the row goes in, and the welcome email with the welcome code goes to whoever owns the address
    expect(error, "a visitor added an address to the list directly").not.toBeNull()
    expect(await onList(email)).toBe(0)
    expect(await welcomes(email)).toBe(0)
  })

  test("one welcome email per address, whatever its letter case and spaces", async () => {
    const email = address("once")
    expect(must(await subscribe(email))).toBe("subscribed")
    expect(must(await subscribe(`  ${email.toUpperCase()} `))).toBe("already_subscribed")
    expect(must(await subscribe(email))).toBe("already_subscribed")
    expect(await onList(email)).toBe(1)
    expect(await welcomes(email)).toBe(1)
  })

  test("an address with a +tag is the same mailbox: one welcome email, kept without the tag", async () => {
    const id = crypto.randomUUID().slice(0, 10)
    expect(must(await subscribe(`tagged-${id}+1@example.test`))).toBe("subscribed")
    // as built: every +tag is a new address, and a new welcome email with the code to the same mailbox
    expect(must(await subscribe(`tagged-${id}+2@example.test`))).toBe("already_subscribed")
    expect(must(await subscribe(`tagged-${id}@example.test`))).toBe("already_subscribed")
    const kept = await sql<{ email: string }>("select email from public.newsletter_subscribers where email like $1", [`tagged-${id}%`])
    expect(kept).toEqual([{ email: `tagged-${id}@example.test` }])
    expect(await welcomes(`tagged-${id}@example.test`)).toBe(1)
  })

  test("an address that isn't one is refused", async () => {
    const { data, error } = await subscribe("not an address")
    expect(data).toBeNull()
    expect(error?.message).toBe("invalid_email")
  })
})

describe("the whole shop, with the limit per visitor off", () => {
  let restore: (() => Promise<unknown>)[] = []
  beforeEach(async () => {
    restore = [await setting("proxy_hops", 0)]
  })
  afterEach(async () => {
    for (const r of restore.reverse()) await r()
  })

  test("takes only so many new sign-ups in an hour", async () => {
    // room for two more than the shop has had in the last hour
    restore.push(await setting("newsletter_signups_per_hour", (await lastHour()) + 2))
    const emails = [address("hour-1"), address("hour-2"), address("hour-3")]
    expect(must(await subscribe(emails[0]))).toBe("subscribed")
    expect(must(await subscribe(emails[1]))).toBe("subscribed")
    const third = await subscribe(emails[2])
    // as built: no limit at all; every address a script sends gets the welcome email
    expect(third.data, "a sign-up over the shop's limit for the hour").toBeNull()
    expect([third.error?.message, third.error?.details]).toEqual(["too_many_signups", "shop"])
    expect(await onList(emails[2])).toBe(0)
    expect(await welcomes(emails[2])).toBe(0)
    // someone already on the list is still told so, and nothing is sent
    expect(must(await subscribe(emails[0]))).toBe("already_subscribed")
    expect(await welcomes(emails[0])).toBe(1)
  })
})

describe("one visitor, with the limit per visitor switched on", () => {
  let restore: () => Promise<unknown>
  beforeEach(async () => {
    restore = await visitorLimitOn()
  })
  afterEach(() => restore())

  test("signs up at most three new addresses a day", async () => {
    const results: string[] = []
    const emails = Array.from({ length: 5 }, (_, i) => address(`visitor-${i}`))
    for (const email of emails) {
      const r = await subscribe(email)
      results.push(r.error ? `${r.error.message}/${r.error.details}` : String(r.data))
    }
    expect(results).toEqual(["subscribed", "subscribed", "subscribed", "too_many_signups/visitor", "too_many_signups/visitor"])
    for (const email of emails.slice(3)) expect(await welcomes(email)).toBe(0)
  })

  test("where a sign-up came from is kept only as a hash, and nobody can read it", async () => {
    const email = address("origin")
    must(await subscribe(email))
    const [origin] = await sql<{ address: string }>(
      "select g.address from public.newsletter_origins g join public.newsletter_subscribers n on n.id = g.subscriber_id where n.email = $1", [email])
    expect(origin.address).toMatch(/^[0-9a-f]{64}$/)
    for (const who of [visitor(), o.sb]) {
      const read = await who.from("newsletter_origins").select("*")
      expect(read.data ?? []).toEqual([])
    }
  })
})

describe("the limits themselves", () => {
  test("are not readable by visitors or customers, and are there for the owner", async () => {
    const columns = ["newsletter_signups_per_hour", "guest_bank_orders_waiting", "guest_orders_per_hour"]
    const c = await customer("settings-reader")
    for (const [who, sb] of [["a visitor", visitor()], ["a signed-in customer", c.sb]] as const) {
      for (const column of [...columns, "*"]) {
        const one = await sb.from("shop_settings").select(column)
        expect(one.data, `${column} is readable by ${who}`).toBeNull()
      }
    }
    const s = must(await o.sb.rpc("admin_settings")) as Record<string, unknown>
    expect(Object.keys(s)).toEqual(expect.arrayContaining(columns))
  })
})

describe("the owner", () => {
  test("still sees who signed up, and can take an address off the list", async () => {
    const c = await customer("newsletter-customer")
    expect(must(await subscribe(c.email, c.sb))).toBe("subscribed")
    const list = must(await o.sb.rpc("admin_customers")) as { email: string; newsletter: boolean }[]
    expect(list.find((x) => x.email === c.email)?.newsletter).toBe(true)
    const rows = must(await o.sb.from("newsletter_subscribers").select("email").eq("email", c.email))
    expect(rows).toEqual([{ email: c.email }])
    must(await o.sb.from("newsletter_subscribers").delete().eq("email", c.email))
    expect(await onList(c.email)).toBe(0)
  })

  test.skipIf(demoSignups === 0)("can still remove the made-up history's sign-ups with the rest of it", async () => {
    const db = new pg.Client({ connectionString: DB })
    await db.connect()
    try {
      // tried and then undone: the history stays in place for the other checks
      await db.query("begin")
      await db.query(`create temporary table _demo_signups on commit drop as
        select n.id, lower(n.email) as email from public.newsletter_subscribers n where lower(n.email) in (select email from public.demo_people)`)
      // one of its sign-ups as if it had come through the limit per visitor
      await db.query("insert into public.newsletter_origins (subscriber_id, address) select id, repeat('a', 64) from _demo_signups limit 1")
      const removed = (await db.query("select public.remove_demo_history() as r")).rows[0].r as { newsletter: number }
      expect(removed.newsletter).toBe(demoSignups)
      const left = await db.query(`select (select count(*)::int from public.newsletter_subscribers where lower(email) in (select email from _demo_signups)) as subs,
        (select count(*)::int from public.newsletter_origins where subscriber_id in (select id from _demo_signups)) as origins`)
      expect(left.rows[0]).toEqual({ subs: 0, origins: 0 })
    } finally {
      await db.query("rollback")
      await db.end()
    }
  })
})
