-- Reviews (from customers whose order was delivered, read by the owner before
-- they appear, with an optional reply from the shop), a wish list, and an
-- email when an unpaid order cancels itself.

-- ---------------------------------------------------------------------------
-- Email: order cancelled because it wasn't paid in time
-- ---------------------------------------------------------------------------
alter table public.emails drop constraint emails_kind_check;
alter table public.emails add constraint emails_kind_check check (kind in (
  'order_confirmation', 'payment_reminder', 'order_cancelled', 'payment_received', 'order_shipped', 'order_delivered',
  'return_approved', 'return_refused', 'refund_sent', 'newsletter_welcome'));

create or replace function public.email_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = old.status then return null; end if;
  if new.status = 'paid' then
    perform public.queue_order_email(new.id, 'payment_received');
  elsif new.status = 'shipped' then
    perform public.queue_order_email(new.id, 'order_shipped');
  elsif new.status = 'delivered' then
    perform public.queue_order_email(new.id, 'order_delivered');
  elsif new.status = 'cancelled' and new.cancel_reason = 'not_paid' then
    perform public.queue_order_email(new.id, 'order_cancelled');
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Which product each ordered piece belongs to (slugs can change, ids don't)
-- ---------------------------------------------------------------------------
alter table public.order_items add column product_id uuid references public.products (id) on delete set null;

update public.order_items i set product_id = v.product_id
from public.product_variants v where v.id = i.variant_id and i.product_id is null;

create or replace function public.set_order_item_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.product_id is null and new.variant_id is not null then
    select v.product_id into new.product_id from public.product_variants v where v.id = new.variant_id;
  end if;
  return new;
end;
$$;

create trigger order_items_set_product
  before insert on public.order_items
  for each row execute function public.set_order_item_product();

create index order_items_product_idx on public.order_items (product_id);

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
alter table public.products
  add column rating_avg numeric(3, 2),
  add column rating_count int not null default 0;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  -- How it fits; not asked for scarves and blankets.
  fit text check (fit in ('small', 'true', 'large')),
  body text not null check (char_length(body) between 1 and 2000),
  -- As shown on the shop, e.g. "Anna K." (taken from the account name when written).
  author_name text not null,
  -- 'pending' until the owner has read it; 'published' shows it; 'rejected' keeps it off the shop.
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  shop_reply text check (shop_reply is null or char_length(shop_reply) between 1 and 2000),
  shop_reply_at timestamptz,
  decided_at timestamptz,
  -- When the customer last changed it (null if never).
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index reviews_product_idx on public.reviews (product_id, created_at desc) where status = 'published';
create index reviews_pending_idx on public.reviews (created_at) where status = 'pending';

alter table public.reviews enable row level security;

-- Published reviews are public. Who wrote them is not: user_id stays out of reach.
create policy "Anyone reads published reviews" on public.reviews
  for select to anon, authenticated using (status = 'published' or public.is_owner());

revoke all on public.reviews from anon, authenticated;
grant select (id, product_id, rating, fit, body, author_name, status, shop_reply, shop_reply_at, edited_at, created_at, updated_at)
  on public.reviews to anon, authenticated;

create trigger reviews_touch_updated_at
  before update on public.reviews
  for each row execute function public.touch_updated_at();

-- Keep each product's average and count of published reviews up to date.
create or replace function public.refresh_product_rating(p_product_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.products p
  set rating_avg = r.avg, rating_count = r.n
  from (
    select round(avg(rating), 2) as avg, count(*)::int as n
    from public.reviews where product_id = p_product_id and status = 'published'
  ) r
  where p.id = p_product_id
    and (p.rating_count is distinct from r.n or p.rating_avg is distinct from r.avg);
$$;

revoke all on function public.refresh_product_rating(uuid) from public, anon, authenticated;

create or replace function public.reviews_refresh_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.refresh_product_rating(old.product_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.product_id <> old.product_id) then
    perform public.refresh_product_rating(new.product_id);
  end if;
  return null;
end;
$$;

create trigger reviews_rating
  after insert or update or delete on public.reviews
  for each row execute function public.reviews_refresh_rating();

-- Does this product ask how it fits?
create or replace function public.review_asks_fit(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select category_slug not in ('scarves', 'blankets') from public.products where id = p_product_id), false);
$$;

grant execute on function public.review_asks_fit(uuid) to anon, authenticated;

-- The signed-in customer's delivered pieces, each with their review if they wrote one.
create or replace function public.my_reviewables()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x ->> 'delivered_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'product_id', p.id, 'slug', p.slug, 'name', p.name, 'images', to_jsonb(p.images), 'colours', p.colours,
      'category_slug', p.category_slug, 'is_published', p.is_published,
      'asks_fit', p.category_slug not in ('scarves', 'blankets'),
      'delivered_at', max(o.delivered_at),
      'bought', jsonb_agg(distinct jsonb_build_object('colour', i.colour, 'size', i.size)),
      'review', (select to_jsonb(r) - 'user_id' from public.reviews r where r.product_id = p.id and r.user_id = auth.uid())
    ) as x
    from public.orders o
    join public.order_items i on i.order_id = o.id
    join public.products p on p.id = i.product_id
    where o.user_id = auth.uid() and o.status = 'delivered'
    group by p.id
  ) t;
$$;

revoke all on function public.my_reviewables() from public, anon;
grant execute on function public.my_reviewables() to authenticated;

-- Write or change a review. Changing one sends it back to the owner to read.
create or replace function public.submit_review(p_product_id uuid, p_rating int, p_fit text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_author text;
  v_initial text;
  v_asks_fit boolean := public.review_asks_fit(p_product_id);
  v_body text := trim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if not exists (
    select 1 from public.orders o join public.order_items i on i.order_id = o.id
    where o.user_id = v_user and o.status = 'delivered' and i.product_id = p_product_id
  ) then
    raise exception 'not_delivered';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating'; end if;
  if v_body = '' or char_length(v_body) > 2000 then raise exception 'invalid_body'; end if;
  if v_asks_fit and (p_fit is null or p_fit not in ('small', 'true', 'large')) then raise exception 'invalid_fit'; end if;
  if not v_asks_fit then p_fit := null; end if;

  -- "Anna Kalniņa" → "Anna K."
  select nullif(trim(full_name), '') into v_name from public.profiles where id = v_user;
  v_initial := upper(substring(regexp_replace(v_name, '^\S+\s*', '') from '[[:alpha:]]'));
  v_author := case
    when v_name is null then 'A Nordaloom customer'
    when v_initial is null then split_part(v_name, ' ', 1)
    else split_part(v_name, ' ', 1) || ' ' || v_initial || '.'
  end;

  insert into public.reviews (product_id, user_id, rating, fit, body, author_name)
  values (p_product_id, v_user, p_rating, p_fit, v_body, v_author)
  on conflict (user_id, product_id) do update
    set rating = excluded.rating, fit = excluded.fit, body = excluded.body, author_name = excluded.author_name,
        status = 'pending', decided_at = null, edited_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_review(uuid, int, text, text) from public, anon;
grant execute on function public.submit_review(uuid, int, text, text) to authenticated;

create or replace function public.delete_my_review(p_review_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.reviews where id = p_review_id and user_id = auth.uid();
$$;

revoke all on function public.delete_my_review(uuid) from public, anon;
grant execute on function public.delete_my_review(uuid) to authenticated;

-- Owner: every review with who wrote it and the order it came from.
create or replace function public.admin_reviews()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  return coalesce((
    select jsonb_agg((to_jsonb(r) - 'user_id') || jsonb_build_object(
      'email', u.email,
      'product', jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name, 'images', to_jsonb(p.images), 'colours', p.colours, 'category_slug', p.category_slug),
      'order_number', (
        select o.order_number from public.orders o join public.order_items i on i.order_id = o.id
        where o.user_id = r.user_id and i.product_id = r.product_id and o.status = 'delivered'
        order by o.delivered_at desc limit 1)
    ) order by r.created_at desc)
    from public.reviews r
    join public.products p on p.id = r.product_id
    left join auth.users u on u.id = r.user_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_reviews() from public, anon;
grant execute on function public.admin_reviews() to authenticated;

-- Owner: publish / don't publish, and write, change or remove the shop's reply.
create or replace function public.admin_update_review(p_review_id uuid, p_status text default null, p_reply text default null, p_set_reply boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reply text := nullif(trim(coalesce(p_reply, '')), '');
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if p_status is not null and p_status not in ('pending', 'published', 'rejected') then raise exception 'invalid_status'; end if;
  update public.reviews set
    status = coalesce(p_status, status),
    decided_at = case when p_status is not null and p_status <> status then now() else decided_at end,
    shop_reply = case when p_set_reply then v_reply else shop_reply end,
    shop_reply_at = case when p_set_reply then (case when v_reply is null then null
                                                     when v_reply is distinct from shop_reply then now()
                                                     else shop_reply_at end)
                         else shop_reply_at end
  where id = p_review_id;
  if not found then raise exception 'not_found'; end if;
end;
$$;

revoke all on function public.admin_update_review(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_update_review(uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Wish list
-- ---------------------------------------------------------------------------
create table public.wishlist_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

alter table public.wishlist_items enable row level security;

create policy "Customers read own wish list" on public.wishlist_items
  for select to authenticated using (user_id = auth.uid());
create policy "Customers add to own wish list" on public.wishlist_items
  for insert to authenticated with check (user_id = auth.uid());
create policy "Customers remove from own wish list" on public.wishlist_items
  for delete to authenticated using (user_id = auth.uid());

-- Each customer's list stays a reasonable size.
create or replace function public.wishlist_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.wishlist_items where user_id = new.user_id) >= 200 then
    raise exception 'wishlist_full';
  end if;
  return new;
end;
$$;

create trigger wishlist_items_limit
  before insert on public.wishlist_items
  for each row execute function public.wishlist_limit();
