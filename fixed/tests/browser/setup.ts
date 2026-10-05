// Before and after the browser checks: nothing held by unpaid test orders (the shop limits those per visitor), no
// test sign-ups on the newsletter, and the shop-wide limits on orders without an account lifted for the run (see
// guestLimitsLifted).
import { cancelTestOrders, forgetTestSignups, guestLimitsLifted, putShelfBack, shelf } from "../helpers"

export default async function setup() {
  await cancelTestOrders()
  await forgetTestSignups()
  const before = await shelf()
  const restoreLimits = await guestLimitsLifted()
  return async () => {
    try {
      await cancelTestOrders()
      await forgetTestSignups()
      await putShelfBack(before)
    } finally {
      await restoreLimits()
    }
  }
}
