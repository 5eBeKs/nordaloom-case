-- Discount codes: percentage or fixed amount, optional end date, total use
-- limit, minimum order, first-order-only and once-per-customer rules.
-- A code's "uses" are orders placed with it that weren't cancelled.

create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,30}$'),
  note text not null default '' check (length(note) <= 200),
  kind text not null check (kind in ('percent', 'fixed')),
  -- percent: 1–100; fixed: euro cents
  value int not null check (value > 0),
  min_order_cents int check (min_order_cents > 0),
  ends_at timestamptz,
  max_uses int check (max_uses > 0),
  first_order_only boolean not null default false,
  once_per_customer boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);

alter table public.discount_codes enable row level security;
-- Customers never read the list; codes are checked through check_discount().
create policy "Owner manages discount codes" on public.discount_codes
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

alter table public.orders
  add column discount_code_id uuid references public.discount_codes (id) on delete set null,
  add column discount_code text,
  add column discount_cents int not null default 0 check (discount_cents >= 0);

create index orders_discount_idx on public.orders (discount_code_id) where discount_code_id is not null;

-- ---------------------------------------------------------------------------
-- Evaluate a code for a basket. Used by check_discount() (the bag) and
-- place_order() (for real, with the code row locked).
-- Returns { ok, code, kind, value, discount_cents, reason?, min_order_cents?,
--           first_order_only, needs_email }
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_discount(
  p_code public.discount_codes,
  p_subtotal_cents int,
  p_email text,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_known boolean := v_email <> '' or p_user_id is not null;
  v_uses int;
  v_discount int;
  v_base jsonb := jsonb_build_object(
    'code', p_code.code, 'kind', p_code.kind, 'value', p_code.value,
    'min_order_cents', p_code.min_order_cents, 'first_order_only', p_code.first_order_only,
    'once_per_customer', p_code.once_per_customer, 'ends_at', p_code.ends_at);
begin
  if not p_code.is_active then
    return v_base || jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;
  if p_code.ends_at is not null and now() >= p_code.ends_at then
    return v_base || jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if p_code.max_uses is not null then
    select count(*) into v_uses from public.orders
    where discount_code_id = p_code.id and status <> 'cancelled';
    if v_uses >= p_code.max_uses then
      return v_base || jsonb_build_object('ok', false, 'reason', 'used_up');
    end if;
  end if;
  if p_code.min_order_cents is not null and p_subtotal_cents < p_code.min_order_cents then
    return v_base || jsonb_build_object('ok', false, 'reason', 'min_order');
  end if;

  -- Rules about the customer (by account or email; cancelled orders don't count).
  if v_known and p_code.first_order_only and exists (
    select 1 from public.orders o
    where o.status <> 'cancelled'
      and ((p_user_id is not null and o.user_id = p_user_id) or (v_email <> '' and lower(o.email) = v_email))
  ) then
    return v_base || jsonb_build_object('ok', false, 'reason', 'not_first_order');
  end if;
  if v_known and p_code.once_per_customer and exists (
    select 1 from public.orders o
    where o.status <> 'cancelled' and o.discount_code_id = p_code.id
      and ((p_user_id is not null and o.user_id = p_user_id) or (v_email <> '' and lower(o.email) = v_email))
  ) then
    return v_base || jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  v_discount := case p_code.kind
    when 'percent' then round(p_subtotal_cents * p_code.value / 100.0)::int
    else least(p_code.value, p_subtotal_cents)
  end;

  return v_base || jsonb_build_object(
    'ok', true,
    'discount_cents', v_discount,
    -- A guest's first-order / once-per-customer rule can only be checked once we know their email.
    'needs_email', not v_known and (p_code.first_order_only or p_code.once_per_customer)
  );
end;
$$;

revoke all on function public.evaluate_discount(public.discount_codes, int, text, uuid) from public, anon, authenticated;

-- The bag and checkout ask about one exact code.
create or replace function public.check_discount(p_code text, p_subtotal_cents int, p_email text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code public.discount_codes;
begin
  select * into v_code from public.discount_codes where code = upper(trim(coalesce(p_code, '')));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'code', upper(trim(coalesce(p_code, ''))));
  end if;
  return public.evaluate_discount(v_code, greatest(coalesce(p_subtotal_cents, 0), 0), p_email, auth.uid());
end;
$$;

revoke all on function public.check_discount(text, int, text) from public;
grant execute on function public.check_discount(text, int, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- place_order, now with an optional discount code. The code row is locked so
-- the last allowed use can't be taken twice. Free delivery counts from the
-- amount after the discount.
-- ---------------------------------------------------------------------------
drop function public.place_order(jsonb, jsonb, text, text);

create function public.place_order(
  items jsonb,
  customer jsonb,
  shipping_code text,
  parcel_locker text default '',
  discount_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(customer ->> 'email', '')));
  v_name text := trim(coalesce(customer ->> 'full_name', ''));
  v_phone text := trim(coalesce(customer ->> 'phone', ''));
  v_country text := upper(trim(coalesce(customer ->> 'country', '')));
  v_line1 text := trim(coalesce(customer ->> 'address_line1', ''));
  v_line2 text := trim(coalesce(customer ->> 'address_line2', ''));
  v_city text := trim(coalesce(customer ->> 'city', ''));
  v_postal text := trim(coalesce(customer ->> 'postal_code', ''));
  v_locker text := trim(coalesce(parcel_locker, ''));
  v_code_text text := upper(trim(coalesce(discount_code, '')));
  v_code public.discount_codes;
  v_check jsonb;
  v_discount int := 0;
  v_rate public.shipping_rates;
  v_settings public.shop_settings;
  v_item record;
  v_problems jsonb := '[]'::jsonb;
  v_subtotal int := 0;
  v_shipping int;
  v_total int;
  v_order public.orders;
begin
  -- Customer details
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = 'P0001', message = 'invalid_email';
  end if;
  if length(v_name) < 2 or length(v_phone) < 6 or v_line1 = '' or v_city = '' or v_postal = '' then
    raise exception using errcode = 'P0001', message = 'missing_details';
  end if;
  if length(v_name) > 200 or length(v_phone) > 40 or length(v_line1) > 200 or length(v_line2) > 200
     or length(v_city) > 100 or length(v_postal) > 20 or length(v_locker) > 200 then
    raise exception using errcode = 'P0001', message = 'details_too_long';
  end if;

  -- Shipping (EU only: a rate must cover the country)
  select * into v_rate from public.shipping_rates r where r.code = place_order.shipping_code;
  if not found or not (v_country = any (v_rate.countries)) then
    raise exception using errcode = 'P0001', message = 'invalid_shipping';
  end if;
  if v_rate.needs_locker and v_locker = '' then
    raise exception using errcode = 'P0001', message = 'missing_locker';
  end if;

  -- Items: merge duplicates, then lock the variant rows.
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception using errcode = 'P0001', message = 'empty_cart';
  end if;

  create temporary table _lines on commit drop as
    select (e ->> 'variant_id')::uuid as variant_id, sum((e ->> 'quantity')::int)::int as quantity
    from jsonb_array_elements(items) e
    group by 1;

  if exists (select 1 from _lines where quantity is null or quantity < 1 or quantity > 20) then
    raise exception using errcode = 'P0001', message = 'invalid_quantity';
  end if;

  select v_problems || coalesce(jsonb_agg(jsonb_build_object('variant_id', l.variant_id, 'available', 0)), '[]'::jsonb)
  into v_problems
  from _lines l
  where not exists (select 1 from public.product_variants v where v.id = l.variant_id);

  for v_item in
    select l.variant_id, l.quantity, v.stock, coalesce(v.price_cents, p.price_cents) as unit_price, p.name, p.is_published
    from _lines l
    join public.product_variants v on v.id = l.variant_id
    join public.products p on p.id = v.product_id
    order by l.variant_id
    for update of v
  loop
    if not v_item.is_published then
      v_problems := v_problems || jsonb_build_object('variant_id', v_item.variant_id, 'available', 0);
    elsif v_item.stock < v_item.quantity then
      v_problems := v_problems || jsonb_build_object('variant_id', v_item.variant_id, 'name', v_item.name, 'available', v_item.stock);
    else
      v_subtotal := v_subtotal + v_item.unit_price * v_item.quantity;
    end if;
  end loop;

  if jsonb_array_length(v_problems) > 0 then
    raise exception using errcode = 'P0001', message = 'out_of_stock', detail = v_problems::text;
  end if;

  -- Discount code, checked for real with its row locked.
  if v_code_text <> '' then
    select * into v_code from public.discount_codes where code = v_code_text for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'discount_invalid', detail = 'not_found';
    end if;
    v_check := public.evaluate_discount(v_code, v_subtotal, v_email, auth.uid());
    if not (v_check ->> 'ok')::boolean then
      raise exception using errcode = 'P0001', message = 'discount_invalid', detail = v_check ->> 'reason';
    end if;
    v_discount := (v_check ->> 'discount_cents')::int;
  end if;

  select * into v_settings from public.shop_settings limit 1;
  v_shipping := case when v_subtotal - v_discount >= v_settings.free_shipping_threshold_cents then 0 else v_rate.price_cents end;
  v_total := v_subtotal - v_discount + v_shipping;

  insert into public.orders (
    user_id, email, full_name, phone, country, address_line1, address_line2, city, postal_code,
    shipping_code, shipping_label, parcel_locker, subtotal_cents, shipping_cents, total_cents, vat_cents,
    payment_reference, discount_code_id, discount_code, discount_cents
  ) values (
    auth.uid(), v_email, v_name, v_phone, v_country, v_line1, v_line2, v_city, v_postal,
    v_rate.code, v_rate.label, v_locker, v_subtotal, v_shipping, v_total,
    round(v_total - v_total / 1.21)::int,
    '', v_code.id, v_code.code, v_discount
  )
  returning * into v_order;

  update public.orders set payment_reference = order_number where id = v_order.id
  returning * into v_order;

  insert into public.order_items (
    order_id, variant_id, product_slug, product_name, product_image, colour, size,
    unit_price_cents, quantity, line_total_cents
  )
  select v_order.id, l.variant_id, p.slug, p.name, p.images[1], v.colour, v.size,
         coalesce(v.price_cents, p.price_cents), l.quantity,
         coalesce(v.price_cents, p.price_cents) * l.quantity
  from _lines l
  join public.product_variants v on v.id = l.variant_id
  join public.products p on p.id = v.product_id;

  update public.product_variants v
  set stock = v.stock - l.quantity
  from _lines l
  where v.id = l.variant_id;

  if auth.uid() is not null then
    delete from public.cart_items c
    using _lines l
    where c.user_id = auth.uid() and c.variant_id = l.variant_id;
  end if;

  return jsonb_build_object('order_number', v_order.order_number, 'access_token', v_order.access_token);
end;
$$;

revoke all on function public.place_order(jsonb, jsonb, text, text, text) from public;
grant execute on function public.place_order(jsonb, jsonb, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin: every code with how often it was used and how much it gave away.
-- ---------------------------------------------------------------------------
create or replace function public.admin_discount_codes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(d) || jsonb_build_object(
      'uses', coalesce(s.uses, 0),
      'paid_uses', coalesce(s.paid_uses, 0),
      'given_cents', coalesce(s.given_cents, 0),
      'pending_cents', coalesce(s.pending_cents, 0),
      'sales_cents', coalesce(s.sales_cents, 0),
      'last_used_at', s.last_used_at
    ) order by d.created_at desc)
    from public.discount_codes d
    left join (
      select discount_code_id,
             count(*) filter (where status <> 'cancelled') as uses,
             count(*) filter (where status in ('paid', 'shipped', 'delivered')) as paid_uses,
             sum(discount_cents) filter (where status in ('paid', 'shipped', 'delivered')) as given_cents,
             sum(discount_cents) filter (where status = 'awaiting_payment') as pending_cents,
             sum(total_cents) filter (where status in ('paid', 'shipped', 'delivered')) as sales_cents,
             max(created_at) filter (where status <> 'cancelled') as last_used_at
      from public.orders
      where discount_code_id is not null
      group by discount_code_id
    ) s on s.discount_code_id = d.id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_discount_codes() from public;
grant execute on function public.admin_discount_codes() to authenticated;

-- A code that has been used can't be deleted (orders point at it) — pause it instead.
create or replace function public.prevent_used_code_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.orders where discount_code_id = old.id) then
    raise exception using errcode = 'P0001', message = 'code_in_use';
  end if;
  return old;
end;
$$;

create trigger discount_codes_prevent_used_delete
  before delete on public.discount_codes
  for each row execute function public.prevent_used_code_delete();
