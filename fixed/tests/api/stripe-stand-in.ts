// A stand-in for Stripe's API, for the card checks: payment pages that can be open, paid or expired, and refunds
// that can be made to fail. The shop's own payment code talks to it through STRIPE_API_BASE; no real key, no money.
import http from "node:http"
import type { AddressInfo } from "node:net"

type Page = { id: string; status: "open" | "complete" | "expired"; payment_status: "unpaid" | "paid"; amount_total: number; metadata: Record<string, string>; payment_intent: string | null }
export type Refund = { id: string; payment_intent: string; amount: number; key: string | null }

export async function standIn() {
  const pages = new Map<string, Page>()
  const refunds: Refund[] = []
  /** Every call the shop made, as "GET /v1/…". */
  const calls: string[] = []
  // ids are this run's own, as Stripe's are unique: a page left by an earlier run is unknown here
  const run = crypto.randomUUID().slice(0, 8)
  let failing = 0
  let notClosing = 0
  let n = 0

  const view = (p: Page) => ({
    id: p.id, status: p.status, payment_status: p.payment_status, amount_total: p.amount_total, currency: "eur", livemode: false, metadata: p.metadata,
    url: `http://stand-in.invalid/pay/${p.id}`,
    payment_intent: p.payment_intent && { id: p.payment_intent, latest_charge: { payment_method_details: { card: { brand: "visa", last4: "4242" } } } },
  })

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const form = new URLSearchParams(Buffer.concat(chunks).toString())
    const path = new URL(req.url!, "http://x").pathname
    calls.push(`${req.method} ${path}`)
    const send = (status: number, body: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body))
    const page = path.match(/^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/)

    if (req.method === "POST" && path === "/v1/checkout/sessions") {
      let total = 0
      for (let i = 0; form.has(`line_items[${i}][quantity]`); i++) total += Number(form.get(`line_items[${i}][quantity]`)) * Number(form.get(`line_items[${i}][price_data][unit_amount]`))
      const p: Page = { id: `cs_stand_in_${run}_${++n}`, status: "open", payment_status: "unpaid", amount_total: total, metadata: { order_id: form.get("metadata[order_id]")!, order_number: form.get("metadata[order_number]")! }, payment_intent: null }
      pages.set(p.id, p)
      return send(200, view(p))
    }
    if (page && pages.has(page[1])) {
      const p = pages.get(page[1])!
      if (req.method === "GET") return send(200, view(p))
      if (page[2]) {
        if (notClosing > 0) {
          notClosing--
          return send(429, { error: { message: "stand-in: too many requests" } })
        }
        if (p.status !== "open") return send(400, { error: { message: `This payment page is ${p.status} and can't be expired.` } })
        p.status = "expired"
        return send(200, view(p))
      }
    }
    if (req.method === "POST" && path === "/v1/refunds") {
      if (failing > 0) {
        failing--
        return send(500, { error: { message: "stand-in: refunds are failing" } })
      }
      const key = (req.headers["idempotency-key"] as string) ?? null
      const again = key && refunds.find((r) => r.key === key)
      if (again) return send(200, again)
      const intent = form.get("payment_intent")!
      const paid = [...pages.values()].find((p) => p.payment_intent === intent)
      if (!paid) return send(400, { error: { message: "No such payment." } })
      const refund = { id: `re_stand_in_${run}_${++n}`, payment_intent: intent, amount: Number(form.get("amount") ?? paid.amount_total), key }
      refunds.push(refund)
      return send(200, refund)
    }
    send(404, { error: { message: `stand-in: nothing at ${req.method} ${path}` } })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    pages,
    refunds,
    /** The customer pays on the payment page. */
    pay(id: string) {
      const p = pages.get(id)!
      if (p.status !== "open") throw new Error(`the payment page is ${p.status}`)
      Object.assign(p, { status: "complete", payment_status: "paid", payment_intent: `pi_stand_in_${run}_${++n}` })
    },
    failNextRefunds(count: number) {
      failing = count
    },
    /** Stripe answers the next "close this page" calls with an error and leaves the page open. */
    failNextCloses(count: number) {
      notClosing = count
    },
    /** The page's own time runs out (Stripe expires it). */
    expire(id: string) {
      pages.get(id)!.status = "expired"
    },
    /** Stripe no longer knows the page: the shop's keys were changed. */
    forget(id: string) {
      pages.delete(id)
    },
    /** A page for an order that did not come from the shop's own "start" (for a second payment). */
    open(orderId: string, orderNumber: string, amount: number) {
      const p: Page = { id: `cs_stand_in_${run}_${++n}`, status: "open", payment_status: "unpaid", amount_total: amount, metadata: { order_id: orderId, order_number: orderNumber }, payment_intent: null }
      pages.set(p.id, p)
      return p.id
    },
    calls,
    close: () => new Promise((r) => server.close(r)),
  }
}
