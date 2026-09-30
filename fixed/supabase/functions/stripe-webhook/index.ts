// Stripe tells the shop about payments here (set up in Stripe's dashboard; see README).
import { envFrom, json } from "../_shared/server.ts"
import { handleStripeWebhook, PaymentError, payEnvFrom } from "../_shared/payments.ts"

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  try {
    const get = (n: string) => Deno.env.get(n)
    // The signature is checked against the exact bytes Stripe sent.
    const payload = await req.text()
    return json(await handleStripeWebhook(payEnvFrom(envFrom(get), get), payload, req.headers.get("Stripe-Signature")))
  } catch (err) {
    if (err instanceof PaymentError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: "server_error" }, 500)
  }
})
