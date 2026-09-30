import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"

export type OutboxEmail = {
  id: string
  kind: string
  to_email: string
  to_name: string | null
  order_id: string | null
  return_id: string | null
  data: Record<string, unknown>
  status: EmailStatus
  created_at: string
  sent_at: string | null
  error: string | null
  attempts: number
  next_attempt_at: string | null
}

export type EmailStatus = "queued" | "sending" | "sent" | "failed" | "skipped"

/** The sender gives up after this many tries (see claim_emails in the database). */
export const MAX_ATTEMPTS = 5

// While something is on its way, look again every few seconds.
const refetchWhileSending = (q: { state: { data?: OutboxEmail[] } }) =>
  q.state.data?.some((e) => e.status === "queued" || e.status === "sending" || (e.status === "failed" && e.attempts < MAX_ATTEMPTS)) ? 4000 : false

export async function retryEmail(id: string) {
  const { error } = await supabase.rpc("retry_email", { p_id: id })
  return !error
}

export function useOutbox() {
  return useQuery({
    queryKey: ["admin-emails"],
    refetchInterval: refetchWhileSending,
    queryFn: async () => {
      const { data, error } = await supabase.from("emails").select("*").order("created_at", { ascending: false }).limit(500)
      if (error) throw error
      return data as OutboxEmail[]
    },
  })
}

export function useOrderEmails(orderId: string | undefined) {
  return useQuery({
    queryKey: ["admin-emails", "order", orderId],
    enabled: !!orderId,
    refetchInterval: refetchWhileSending,
    queryFn: async () => {
      const { data, error } = await supabase.from("emails").select("*").eq("order_id", orderId!).order("created_at")
      if (error) throw error
      return data as OutboxEmail[]
    },
  })
}

/** Settings the templates need to show examples. */
export function useEmailSettings() {
  return useQuery({
    queryKey: ["email-settings"],
    queryFn: async () => {
      // Through the owner's own function: visitors can't read these settings.
      const { data: s, error } = await supabase.rpc("admin_settings")
      if (error) throw error
      const { data: code } = s.welcome_discount_code
        ? await supabase.from("discount_codes").select("code, kind, value, first_order_only, min_order_cents, ends_at, is_active").eq("code", s.welcome_discount_code).maybeSingle()
        : { data: null }
      return {
        siteUrl: s.site_url as string,
        contactEmail: s.contact_email as string,
        welcomeCode: code && code.is_active ? { code: code.code, kind: code.kind, value: code.value, first_order_only: code.first_order_only, min_order_cents: code.min_order_cents, ends_at: code.ends_at } : null,
      }
    },
  })
}
