import { createClient } from "@supabase/supabase-js"
import { trackedFetch } from "@/lib/connection"

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  // Every request also tells us whether the shop could be reached (offline note, sync).
  { global: { fetch: trackedFetch } },
)
