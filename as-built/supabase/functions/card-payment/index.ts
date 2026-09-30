// Card payments: start one, check it, switch to bank transfer, refund (owner).
import { envFrom, json } from "../_shared/server.ts"
import { handleCardPayment, PaymentError, payEnvFrom } from "../_shared/payments.ts"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({})
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  try {
    const get = (n: string) => Deno.env.get(n)
    const body = await req.json().catch(() => ({}))
    return json(await handleCardPayment(payEnvFrom(envFrom(get), get), body, req.headers.get("Authorization")))
  } catch (err) {
    if (err instanceof PaymentError) {
      // Problems with Stripe itself go to the log too (with anything key-like removed).
      if (err.status >= 500) console.error("card-payment:", err.message.replace(/(sk|rk|pk)_(test|live)_[A-Za-z0-9*]+/g, "[key hidden]"))
      return json({ error: err.message }, err.status)
    }
    console.error(err)
    return json({ error: "server_error" }, 500)
  }
})
