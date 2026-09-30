// "Forgot your password?": emails a one-time link to choose a new password.
import { envFrom, json, requestPasswordReset } from "../_shared/server.ts"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({})
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  try {
    const body = await req.json().catch(() => ({}))
    const result = await requestPasswordReset(envFrom((n) => Deno.env.get(n)), body.email)
    return json(result, result.ok ? 200 : 400)
  } catch (err) {
    console.error(err)
    return json({ error: "server_error" }, 500)
  }
})
