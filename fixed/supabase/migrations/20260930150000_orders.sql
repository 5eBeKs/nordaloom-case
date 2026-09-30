-- Checkout: shipping rates, shop settings (bank details), orders and the
-- functions that place, show, pay and cancel them.

-- ---------------------------------------------------------------------------
-- Shipping rates (VAT included). A rate applies to the listed EU countries.
-- ---------------------------------------------------------------------------
create table public.shipping_rates (
  code text primary key,
  label text not null,
  description text not null default '',
  price_cents int not null check (price_cents >= 0),
  countries text[] not null,
  -- Parcel-locker methods ask the customer which locker to deliver to.
  needs_locker boolean not null default false,
  sort_order int not null default 0
);

alter table public.shipping_rates enable row level security;
create policy "Anyone reads shipping rates" on public.shipping_rates
  for select to anon, authenticated using (true);
create policy "Owner manages shipping rates" on public.shipping_rates
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

insert into public.shipping_rates (code, label, description, price_cents, countries, needs_locker, sort_order) values
  ('omniva_lv', 'Omniva parcel locker', 'Delivered to the Omniva locker of your choice', 399, '{LV}', true, 1),
  ('courier_lv', 'Courier', 'Delivered to your door in Latvia', 599, '{LV}', false, 2),
  ('courier_baltic', 'Courier', 'Delivered to your door in Lithuania or Estonia', 699, '{LT,EE}', false, 3),
  ('courier_eu', 'Courier', 'Delivered to your door in the EU',
    1290, '{AT,BE,BG,HR,CY,CZ,DK,FI,FR,DE,GR,HU,IE,IT,LU,MT,NL,PL,PT,RO,SK,SI,ES,SE}', false, 4);

-- ---------------------------------------------------------------------------
-- Shop settings (a single row)
-- ---------------------------------------------------------------------------
create table public.shop_settings (
  id boolean primary key default true check (id),
  free_shipping_threshold_cents int not null default 15000,
  bank_recipient text not null,
  bank_iban text not null,
  bank_bic text not null default '',
  bank_name text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.shop_settings enable row level security;
create policy "Anyone reads shop settings" on public.shop_settings
  for select to anon, authenticated using (true);
create policy "Owner updates shop settings" on public.shop_settings
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- PLACEHOLDER bank details: replace with the real account before taking orders.
insert into public.shop_settings (bank_recipient, bank_iban, bank_bic, bank_name)
values ('Nordaloom', 'LV00 0000 0000 0000 0000 0', 'XXXXLV2X', 'Bank name');

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create sequence public.order_number_seq start 10001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('NRD-' || nextval('public.order_number_seq')),
  -- Lets a guest open their own confirmation page without an account.
  access_token uuid not null default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'paid', 'shipped', 'cancelled')),
  email text not null,
  full_name text not null,
  phone text not null,
  country text not null,
  address_line1 text not null,
  address_line2 text not null default '',
  city text not null,
  postal_code text not null,
  shipping_code text not null references public.shipping_rates (code),
  shipping_label text not null,
  parcel_locker text not null default '',
  subtotal_cents int not null,
  shipping_cents int not null,
  total_cents int not null,
  vat_cents int not null,
  -- The customer writes this in their bank transfer.
  payment_reference text not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  cancelled_at timestamptz
);

create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_status_idx on public.orders (status, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete set null,
  product_slug text not null,
  product_name text not null,
  product_image text,
  colour text not null,
  size text not null,
  unit_price_cents int not null,
  quantity int not null check (quantity > 0),
  line_total_cents int not null
);

create index order_items_order_idx on public.order_items (order_id);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Orders are created only through place_order(). Customers see their own.
create policy "Customers read own orders" on public.orders
  for select to authenticated using (user_id = auth.uid() or public.is_owner());
create policy "Customers read own order items" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_owner()))
  );

-- ---------------------------------------------------------------------------
-- place_order: validates everything server-side, locks and decrements stock,
-- prices the order from the database and saves it — all in one transaction.
-- items: [{ "variant_id": uuid, "quantity": int }, ...]
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  items jsonb,
  customer jsonb,
  shipping_code text,
  parcel_locker text default ''
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

  -- Items: merge duplicates, then lock the variant rows so two orders can't
  -- take the same stock.
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

  -- Variants that no longer exist
  select v_problems || coalesce(jsonb_agg(jsonb_build_object('variant_id', l.variant_id, 'available', 0)), '[]'::jsonb)
  into v_problems
  from _lines l
  where not exists (select 1 from public.product_variants v where v.id = l.variant_id);

  for v_item in
    select l.variant_id, l.quantity, v.stock, v.colour, v.size,
           coalesce(v.price_cents, p.price_cents) as unit_price,
           p.slug, p.name, p.is_published
    from _lines l
    join public.product_variants v on v.id = l.variant_id
    join public.products p on p.id = v.product_id
    order by l.variant_id
    for update of v
  loop
    if not v_item.is_published then
      v_problems := v_problems || jsonb_build_object('variant_id', v_item.variant_id, 'available', 0);
    elsif v_item.stock < v_item.quantity then
      v_problems := v_problems || jsonb_build_object(
        'variant_id', v_item.variant_id, 'name', v_item.name, 'available', v_item.stock);
    else
      v_subtotal := v_subtotal + v_item.unit_price * v_item.quantity;
    end if;
  end loop;

  if jsonb_array_length(v_problems) > 0 then
    raise exception using errcode = 'P0001', message = 'out_of_stock', detail = v_problems::text;
  end if;

  select * into v_settings from public.shop_settings limit 1;
  v_shipping := case when v_subtotal >= v_settings.free_shipping_threshold_cents then 0 else v_rate.price_cents end;
  v_total := v_subtotal + v_shipping;

  insert into public.orders (
    user_id, email, full_name, phone, country, address_line1, address_line2, city, postal_code,
    shipping_code, shipping_label, parcel_locker, subtotal_cents, shipping_cents, total_cents, vat_cents,
    payment_reference
  ) values (
    auth.uid(), v_email, v_name, v_phone, v_country, v_line1, v_line2, v_city, v_postal,
    v_rate.code, v_rate.label, v_locker, v_subtotal, v_shipping, v_total,
    round(v_total - v_total / 1.21)::int,
    ''
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

  -- A signed-in customer's saved bag is emptied of what they just bought.
  if auth.uid() is not null then
    delete from public.cart_items c
    using _lines l
    where c.user_id = auth.uid() and c.variant_id = l.variant_id;
  end if;

  return jsonb_build_object('order_number', v_order.order_number, 'access_token', v_order.access_token);
end;
$$;

revoke all on function public.place_order(jsonb, jsonb, text, text) from public;
grant execute on function public.place_order(jsonb, jsonb, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_order: the confirmation page for a guest (order number + secret token),
-- the customer who placed it, or the owner.
-- ---------------------------------------------------------------------------
create or replace function public.get_order(p_order_number text, p_token uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_settings public.shop_settings;
begin
  select * into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;
  if not (
    (p_token is not null and v_order.access_token = p_token)
    or (auth.uid() is not null and v_order.user_id = auth.uid())
    or public.is_owner()
  ) then
    return null;
  end if;

  select * into v_settings from public.shop_settings limit 1;

  return (to_jsonb(v_order) - 'access_token') || jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - 'order_id' order by i.product_name)
      from public.order_items i where i.order_id = v_order.id
    ), '[]'::jsonb),
    'bank', jsonb_build_object(
      'recipient', v_settings.bank_recipient,
      'iban', v_settings.bank_iban,
      'bic', v_settings.bank_bic,
      'bank_name', v_settings.bank_name
    )
  );
end;
$$;

revoke all on function public.get_order(text, uuid) from public;
grant execute on function public.get_order(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Owner actions: paid → shipped, or cancel (puts the stock back).
-- ---------------------------------------------------------------------------
create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if p_status = 'paid' and v_order.status = 'awaiting_payment' then
    update public.orders set status = 'paid', paid_at = now() where id = p_order_id returning * into v_order;
  elsif p_status = 'shipped' and v_order.status = 'paid' then
    update public.orders set status = 'shipped', shipped_at = now() where id = p_order_id returning * into v_order;
  elsif p_status = 'cancelled' and v_order.status in ('awaiting_payment', 'paid') then
    update public.product_variants v
    set stock = v.stock + i.quantity
    from public.order_items i
    where i.order_id = p_order_id and i.variant_id = v.id;
    update public.orders set status = 'cancelled', cancelled_at = now() where id = p_order_id returning * into v_order;
  else
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  return v_order;
end;
$$;

revoke all on function public.set_order_status(uuid, text) from public;
grant execute on function public.set_order_status(uuid, text) to authenticated;
