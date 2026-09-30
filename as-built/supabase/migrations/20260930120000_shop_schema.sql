-- Nordaloom shop: catalogue, customer profiles, carts and newsletter.

-- ---------------------------------------------------------------------------
-- Profiles & roles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'customer' check (role in ('customer', 'owner')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- True when the signed-in user is the shop owner. Used by RLS policies
-- (and by the admin side later).
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

-- Every new auth user gets a profile. The owner's address is promoted
-- automatically so the admin side works as soon as they sign up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case when lower(new.email) = 'owner@nordaloom.example' then 'owner' else 'customer' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "Users read own profile" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_owner());

create policy "Users update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Customers may change their name, never their role.
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table public.categories (
  slug text primary key,
  name text not null,
  tagline text not null default '',
  description text not null default '',
  sort_order int not null default 0
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category_slug text not null references public.categories (slug) on update cascade,
  name text not null,
  short_description text not null default '',
  description text not null default '',
  materials text not null default '',
  care text[] not null default '{}',
  details text[] not null default '{}',
  -- Price in euro cents, VAT included.
  price_cents int not null check (price_cents >= 0),
  -- [{ "name": "Oat", "hex": "#d8cbb5" }, ...] in display order
  colours jsonb not null default '[]'::jsonb,
  -- Size labels in display order, e.g. {XS,S,M,L,XL} or {One size}
  sizes text[] not null default '{}',
  -- Public image URLs in display order. Empty until real photos are uploaded.
  images text[] not null default '{}',
  is_featured boolean not null default false,
  is_new boolean not null default false,
  is_published boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_idx on public.products (category_slug, sort_order);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  colour text not null,
  size text not null,
  stock int not null default 0 check (stock >= 0),
  -- Optional price override (euro cents, VAT incl.), e.g. a larger blanket size.
  price_cents int check (price_cents >= 0),
  unique (product_id, colour, size)
);

create index product_variants_product_idx on public.product_variants (product_id);

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;

create policy "Anyone reads categories" on public.categories
  for select to anon, authenticated using (true);
create policy "Owner manages categories" on public.categories
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy "Anyone reads published products" on public.products
  for select to anon, authenticated using (is_published or public.is_owner());
create policy "Owner manages products" on public.products
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy "Anyone reads variants of published products" on public.product_variants
  for select to anon, authenticated using (
    exists (
      select 1 from public.products p
      where p.id = product_id and (p.is_published or public.is_owner())
    )
  );
create policy "Owner manages variants" on public.product_variants
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Carts (signed-in customers; guests keep their cart in the browser)
-- ---------------------------------------------------------------------------
create table public.cart_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  quantity int not null check (quantity between 1 and 20),
  added_at timestamptz not null default now(),
  primary key (user_id, variant_id)
);

alter table public.cart_items enable row level security;

create policy "Users manage own cart" on public.cart_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Newsletter
-- ---------------------------------------------------------------------------
create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);

create unique index newsletter_subscribers_email_idx
  on public.newsletter_subscribers (lower(email));

alter table public.newsletter_subscribers enable row level security;

create policy "Anyone can subscribe" on public.newsletter_subscribers
  for insert to anon, authenticated with check (true);
create policy "Owner reads subscribers" on public.newsletter_subscribers
  for select to authenticated using (public.is_owner());
create policy "Owner removes subscribers" on public.newsletter_subscribers
  for delete to authenticated using (public.is_owner());

-- ---------------------------------------------------------------------------
-- Product photos (public bucket; only the owner uploads)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "Anyone views product images" on storage.objects
  for select to anon, authenticated using (bucket_id = 'product-images');
create policy "Owner uploads product images" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_owner());
create policy "Owner updates product images" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.is_owner());
create policy "Owner deletes product images" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_owner());
