// Sends the emails waiting in the outbox. The database calls this whenever an
// email is queued, and once a minute to retry anything that failed.
import { envFrom, json, processQueue } from "../_shared/server.ts"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({})
  try {
    return json(await processQueue(envFrom((n) => Deno.env.get(n))))
  } catch (err) {
    console.error(err)
    return json({ error: String(err) }, 500)
  }
})
