import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"

export type ContactTopic = "order" | "returns" | "sizing" | "care" | "wholesale" | "other"

export const CONTACT_TOPICS: { value: ContactTopic; label: string }[] = [
  { value: "order", label: "An order or delivery" },
  { value: "returns", label: "A return" },
  { value: "sizing", label: "Size and fit" },
  { value: "care", label: "Wool and care" },
  { value: "wholesale", label: "Stockists and press" },
  { value: "other", label: "Something else" },
]

export const topicLabel = (t: string) => CONTACT_TOPICS.find((x) => x.value === t)?.label ?? t

export async function sendContactMessage(input: { name: string; email: string; topic: ContactTopic; orderNumber: string; message: string }) {
  const { error } = await supabase.rpc("send_contact_message", {
    p_name: input.name,
    p_email: input.email,
    p_topic: input.topic,
    p_order_number: input.orderNumber,
    p_message: input.message,
  })
  return error ? { ok: false as const, code: error.message } : { ok: true as const }
}

export type ContactStatus = "new" | "read" | "answered"

export type ContactMessage = {
  id: string
  name: string
  email: string
  topic: ContactTopic
  order_number: string | null
  message: string
  user_id: string | null
  status: ContactStatus
  owner_note: string | null
  created_at: string
  answered_at: string | null
}

export function useContactMessages() {
  return useQuery({
    queryKey: ["admin-messages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contact_messages").select("*").order("created_at", { ascending: false }).limit(1000)
      if (error) throw error
      return data as ContactMessage[]
    },
  })
}

export async function updateContactMessage(id: string, change: Partial<Pick<ContactMessage, "status" | "owner_note" | "answered_at">>) {
  const { error } = await supabase.from("contact_messages").update(change).eq("id", id)
  return !error
}

export async function deleteContactMessage(id: string) {
  const { error } = await supabase.from("contact_messages").delete().eq("id", id)
  return !error
}
