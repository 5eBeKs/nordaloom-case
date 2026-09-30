import { useQuery } from "@tanstack/react-query"
import { FunctionsHttpError } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

/** Calls the card-payment server function; returns its answer or an error code. */
async function cardPayment<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; code: string }> {
  const { data, error } = await supabase.functions.invoke("card-payment", { body })
  if (!error) return { ok: true, data: data as T }
  if (error instanceof FunctionsHttpError) {
    const answer = await error.context.json().catch(() => ({}))
    return { ok: false, code: answer.error ?? "server_error" }
  }
  return { ok: false, code: "unreachable" }
}

/** Whether card payments are set up (Stripe key in place and the function running). */
export function useCardPayments() {
  return useQuery({
    queryKey: ["card-payments"],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const r = await cardPayment<{ enabled: boolean; test: boolean }>({ action: "status" })
      return r.ok ? r.data : { enabled: false, test: false }
    },
  })
}

/** Opens Stripe's payment page for the order (the browser leaves the shop). */
export async function goToCardPayment(orderNumber: string, token: string | null) {
  const r = await cardPayment<{ url: string }>({ action: "start", order_number: orderNumber, token })
  if (!r.ok) return r
  window.location.assign(r.data.url)
  return { ok: true as const }
}

/** Asks Stripe how the order's card payment went, and updates the order. */
export const checkCardPayment = (orderNumber: string, token: string | null) =>
  cardPayment<{ status: string; session?: string }>({ action: "check", order_number: orderNumber, token })

export const switchToBankTransfer = (orderNumber: string, token: string | null) =>
  cardPayment<{ status: string; payment_method?: string }>({ action: "switch_to_bank", order_number: orderNumber, token })

/** Owner: refunds a return to the card it was paid with. */
export const refundReturnToCard = (returnId: string, amountCents: number, restock: boolean) =>
  cardPayment<{ refunded: number }>({ action: "refund_return", return_id: returnId, amount_cents: amountCents, restock })

/** Owner: cancels a paid card order and refunds it in full. */
export const cancelAndRefundCardOrder = (orderId: string) => cardPayment<{ refunded: number }>({ action: "cancel_order", order_id: orderId })

const BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", maestro: "Maestro", discover: "Discover", jcb: "JCB", unionpay: "UnionPay", diners: "Diners Club", cartes_bancaires: "Cartes Bancaires" }

/** "Visa ending 4242" */
export const cardLabel = (brand: string | null | undefined, last4: string | null | undefined) =>
  last4 ? `${BRANDS[brand ?? ""] ?? "Card"} ending ${last4}` : "Card"

export const PAYMENT_ERRORS: Record<string, string> = {
  already_paid: "This order is already paid.",
  not_payable: "This order can't be paid any more.",
  unreachable: "We couldn't reach the payment service. Please try again in a moment.",
}
