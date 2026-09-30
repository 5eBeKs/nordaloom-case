// Before and after the checks: nothing held by unpaid test orders. Also finds the local service key, which the
// card-payment checks need to run the shop's own server code (it is printed by `supabase status`, never stored).
import { execSync } from "node:child_process"
import { cancelTestOrders, putShelfBack, shelf } from "../helpers"

export default async function setup() {
  if (!process.env.TEST_SERVICE_KEY) {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    const key = out.match(/^SERVICE_ROLE_KEY="?([^"\r\n]+)"?/m)?.[1]
    if (!key) throw new Error("Couldn't read the local service key from `supabase status`. Is the local Supabase running?")
    process.env.TEST_SERVICE_KEY = key
  }
  await cancelTestOrders()
  const before = await shelf()
  return async () => {
    await cancelTestOrders()
    await putShelfBack(before)
  }
}
