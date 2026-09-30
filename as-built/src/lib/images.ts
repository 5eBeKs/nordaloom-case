import { supabase } from "@/lib/supabase"

const BUCKET = "product-images"

/** Public URL for an image stored in the product-images bucket (or an absolute URL). */
export function imageUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}
