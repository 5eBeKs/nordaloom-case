-- Prices and stock reach open shops and installed apps at once: the shop
-- listens for changes to products and their variants (Supabase Realtime) and
-- reloads what's on screen. Row-level security still applies to what each
-- visitor is told about.
alter publication supabase_realtime add table public.products, public.product_variants;
