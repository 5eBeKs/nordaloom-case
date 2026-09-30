// Before and after the browser checks: nothing held by unpaid test orders (the shop limits those per visitor).
import { cancelTestOrders, putShelfBack, shelf } from "../helpers"

export default async function setup() {
  await cancelTestOrders()
  const before = await shelf()
  return async () => {
    await cancelTestOrders()
    await putShelfBack(before)
  }
}
