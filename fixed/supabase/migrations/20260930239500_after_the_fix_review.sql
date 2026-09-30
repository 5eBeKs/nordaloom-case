-- Second round: what the independent review of the first fix found
-- (20260930239000_after_the_check.sql), and three things it found that were
-- already in the shop before it.

-- ---------------------------------------------------------------------------
-- Where an order came from: out of the orders table, and not reversible
-- ---------------------------------------------------------------------------
-- The first fix kept a fingerprint of the visitor's address on the order row
-- itself. That row is handed to the order's page and copied into emails, and
-- the fingerprint could be turned back into the address by trying addresses.
-- It now lives in a table nobody reaches through the API, hashed with a secret
-- of this shop's own, and is removed a day after the order stops being unpaid.
drop trigger orders_forget_address on public.orders;
drop function public.orders_forget_address();
drop index public.orders_placed_from_idx;
alter table public.orders drop column placed_from;

create table public.order_origins (
  order_id uuid primary key references public.orders (id) on delete cascade,
  address text not null,
  created_at timestamptz not null default now()
);
create index order_origins_address_idx on public.order_origins (address);
alter table public.order_origins enable row level security;
-- No policies: nobody reaches this through the API.

alter table public.shop_settings
  add column address_salt text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

-- The limit per visitor is OFF until the shop's owner says how many proxies
-- stand in front of the API on the host the shop runs on (0 = off). A wrong
-- number is worse than none: every visitor would look like the same one, and
-- honest customers would be refused. For the local Supabase the right number
-- is 1: update public.shop_settings set proxy_hops = 1;
alter table public.shop_settings drop constraint shop_settings_proxy_hops_check;
alter table public.shop_settings add constraint shop_settings_proxy_hops_check check (proxy_hops between 0 and 5);
alter table public.shop_settings alter column proxy_hops set default 0;
update public.shop_settings set proxy_hops = 0;

create or replace function public.visitor_address()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_header text;
  v_list text[];
  v_settings public.shop_settings;
  v_address text;
begin
  select * into v_settings from public.shop_settings limit 1;
  if v_settings.proxy_hops < 1 then
    return null;
  end if;
  begin
    v_header := nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for';
  exception when others then
    return null;
  end;
  v_list := string_to_array(replace(coalesce(v_header, ''), ' ', ''), ',');
  if coalesce(array_length(v_list, 1), 0) < v_settings.proxy_hops then
    return null;
  end if;
  v_address := nullif(v_list[array_length(v_list, 1) - v_settings.proxy_hops + 1], '');
  if v_address is null then
    return null;
  end if;
  -- Never the address itself: a hash that only this shop's secret reproduces.
  return encode(sha256(convert_to(v_settings.address_salt || '|' || v_address, 'utf8')), 'hex');
end;
$$;

revoke all on function public.visitor_address() from public, anon, authenticated;

select cron.schedule('forget-order-origins', '17 * * * *', $$
  delete from public.order_origins g
  using public.orders o
  where o.id = g.order_id and o.status <> 'awaiting_payment' and g.created_at < now() - interval '1 day'
$$);

-- ---------------------------------------------------------------------------
-- An attempt whose answer was lost
-- ---------------------------------------------------------------------------
-- The key the checkout sends is also kept as it came (next to the order-once
-- key made from it), so that the checkout can ask, before it sends something
-- different after a lost answer, whether the earlier attempt went through.
-- The answer is given only for the same email address, and holds no more than
-- the order's number, total and way of paying.
alter table public.orders add column attempt_key uuid;
create index orders_attempt_key_idx on public.orders (attempt_key) where attempt_key is not null;

create or replace function public.earlier_attempt(p_key uuid, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_number', o.order_number, 'total_cents', o.total_cents, 'payment_method', o.payment_method) order by o.created_at), '[]'::jsonb)
  from public.orders o
  where p_key is not null
    and o.attempt_key = p_key
    and lower(o.email) = lower(trim(coalesce(p_email, '')))
    and o.status = 'awaiting_payment'
    and o.created_at > now() - interval '1 day';
$$;

revoke all on function public.earlier_attempt(uuid, text) from public;
grant execute on function public.earlier_attempt(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- place_order
-- ---------------------------------------------------------------------------
-- * `items: null` is refused like an empty bag (it used to make an order with no pieces).
-- * An order is at most 40 pieces, so one unpaid order cannot take the shelf.
-- * The order-once key: fields are kept apart properly (a "|" typed into one
--   can't make two orders look the same), letter case in names and addresses
--   doesn't make a second order, and a cancelled order is never handed back as
--   "already placed".
-- * Limits on unpaid orders:
--   - three waiting for a bank transfer per email address ("name+tag@" counts
--     as "name@"); a signed-in customer ordering to their own address is not
--     held to it, so nobody else can use it to stop them ordering, and paying
--     by card is never refused by it;
--   - five per account;
--   - per visitor (when switched on, see proxy_hops): eight orders in a day
--     that are unpaid, or were cancelled unpaid, whoever is signed in. Orders
--     that cancel themselves after 40 minutes still count for the day.
drop function public.place_order(jsonb, jsonb, text, text, text, text, uuid, int);

create function public.place_order(
  items jsonb,
  customer jsonb,
  shipping_code text,
  parcel_locker text default '',
  discount_code text default null,
  payment_method text default 'bank_transfer',
  client_key uuid default null,
  expected_total_cents int default null
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
  v_key uuid;
  v_address text;
  v_mailbox text;
  v_own_email boolean := false;
begin
  if items is null or jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) = 0 then
    raise exception using errcode = 'P0001', message = 'empty_cart';
  end if;

  -- The same checkout sent again (a double tap, or a retry after the connection
  -- dropped): hand back the order it already made instead of making another.
  -- "The same" means the same key, person, bag, details and way of paying.
  if client_key is not null then
    v_key := md5(jsonb_build_array(
      client_key, coalesce(auth.uid()::text, ''), v_email, lower(v_name), v_phone, v_country,
      lower(v_line1), lower(v_line2), lower(v_city), upper(v_postal),
      coalesce(shipping_code, ''), lower(v_locker), v_code_text, coalesce(payment_method, ''),
      (select jsonb_agg(jsonb_build_array(x.variant_id, x.quantity) order by x.variant_id)
       from (select ((e ->> 'variant_id')::uuid)::text as variant_id, sum((e ->> 'quantity')::int) as quantity
             from jsonb_array_elements(items) e group by 1) x)
    )::text)::uuid;
    -- Two copies arriving at the same moment: the second waits for the first.
    perform pg_advisory_xact_lock(hashtext(v_key::text));
    select * into v_order from public.orders o where o.client_key = v_key;
    if found and v_order.status <> 'cancelled' and v_order.created_at > now() - interval '1 day' then
      return jsonb_build_object('order_number', v_order.order_number, 'access_token', v_order.access_token,
                                'payment_method', v_order.payment_method, 'already_placed', true);
    end if;
    -- The earlier order was cancelled, or is days old: this is a new order, and the key is its own now.
    if found then
      update public.orders set client_key = null where id = v_order.id;
    end if;
  end if;

  if payment_method not in ('bank_transfer', 'card') then
    raise exception using errcode = 'P0001', message = 'invalid_payment_method';
  end if;

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

  -- Unpaid orders hold stock and send an email with the bank details: only so
  -- many at a time. One at a time per mailbox / account / visitor, so two
  -- requests at once can't both slip under a limit.
  v_mailbox := regexp_replace(v_email, '\+[^@]*@', '@');
  if auth.uid() is not null then
    v_own_email := exists (select 1 from auth.users u where u.id = auth.uid() and lower(u.email) = v_email);
    perform pg_advisory_xact_lock(hashtext('unpaid:' || auth.uid()::text));
    if (select count(*) from public.orders o where o.status = 'awaiting_payment' and o.user_id = auth.uid()) >= 5 then
      raise exception using errcode = 'P0001', message = 'too_many_unpaid', detail = 'account';
    end if;
  end if;
  if place_order.payment_method = 'bank_transfer' and not v_own_email then
    perform pg_advisory_xact_lock(hashtext('unpaid:' || v_mailbox));
    if (select count(*) from public.orders o
        where o.status = 'awaiting_payment' and o.payment_method = 'bank_transfer'
          and regexp_replace(lower(o.email), '\+[^@]*@', '@') = v_mailbox) >= 3 then
      raise exception using errcode = 'P0001', message = 'too_many_unpaid', detail = 'email';
    end if;
  end if;
  v_address := public.visitor_address();
  if v_address is not null then
    perform pg_advisory_xact_lock(hashtext('unpaid:' || v_address));
    if (select count(*) from public.order_origins g join public.orders o on o.id = g.order_id
        where g.address = v_address
          and (o.status = 'awaiting_payment'
               or (o.status = 'cancelled' and o.paid_at is null and g.created_at > now() - interval '1 day'))) >= 8 then
      raise exception using errcode = 'P0001', message = 'too_many_orders';
    end if;
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
  create temporary table _lines on commit drop as
    select (e ->> 'variant_id')::uuid as variant_id, sum((e ->> 'quantity')::int)::int as quantity, null::int as unit_price
    from jsonb_array_elements(items) e
    group by 1;

  if exists (select 1 from _lines where quantity is null or quantity < 1 or quantity > 20) then
    raise exception using errcode = 'P0001', message = 'invalid_quantity';
  end if;
  if (select sum(quantity) from _lines) > 40 then
    raise exception using errcode = 'P0001', message = 'order_too_large';
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
      v_problems := v_problems || jsonb_build_object('variant_id', v_item.variant_id, 'name', v_item.name, 'available', 0, 'withdrawn', true);
    elsif v_item.stock < v_item.quantity then
      v_problems := v_problems || jsonb_build_object('variant_id', v_item.variant_id, 'name', v_item.name, 'available', v_item.stock);
    else
      -- The price the order is made at: the lines below use this same number.
      update _lines set unit_price = v_item.unit_price where variant_id = v_item.variant_id;
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

  -- Not the amount on the button the customer pressed: ask again, order nothing.
  if expected_total_cents is not null and expected_total_cents <> v_total then
    raise exception using errcode = 'P0001', message = 'price_changed', detail = v_total::text;
  end if;

  insert into public.orders (
    user_id, email, full_name, phone, country, address_line1, address_line2, city, postal_code,
    shipping_code, shipping_label, parcel_locker, subtotal_cents, shipping_cents, total_cents, vat_cents,
    payment_reference, discount_code_id, discount_code, discount_cents,
    payment_method, payment_due_at, client_key, attempt_key
  ) values (
    auth.uid(), v_email, v_name, v_phone, v_country, v_line1, v_line2, v_city, v_postal,
    v_rate.code, v_rate.label, v_locker, v_subtotal, v_shipping, v_total,
    round(v_total - v_total / 1.21)::int,
    '', v_code.id, v_code.code, v_discount,
    place_order.payment_method,
    -- Card: the pieces are held while the customer is on the payment page (see set_card_session).
    case when place_order.payment_method = 'card' then now() + interval '40 minutes' end,
    v_key, place_order.client_key
  )
  returning * into v_order;

  update public.orders set payment_reference = order_number where id = v_order.id
  returning * into v_order;

  if v_address is not null then
    insert into public.order_origins (order_id, address) values (v_order.id, v_address);
  end if;

  insert into public.order_items (
    order_id, variant_id, product_slug, product_name, product_image, colour, size,
    unit_price_cents, quantity, line_total_cents
  )
  select v_order.id, l.variant_id, p.slug, p.name, p.images[1], v.colour, v.size,
         l.unit_price, l.quantity, l.unit_price * l.quantity
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

  return jsonb_build_object('order_number', v_order.order_number, 'access_token', v_order.access_token, 'payment_method', v_order.payment_method);
end;
$$;

revoke all on function public.place_order(jsonb, jsonb, text, text, text, text, uuid, int) from public;
grant execute on function public.place_order(jsonb, jsonb, text, text, text, text, uuid, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Card orders
-- ---------------------------------------------------------------------------
-- The owner cancels an unpaid card order. Only the card-payment function calls
-- this, after Stripe has confirmed that the order's payment page is closed.
-- p_session is the page marker the function saw when it closed the page: if
-- the customer has opened another page since, nothing is cancelled and the
-- function goes round again.
drop function public.cancel_open_card_order(uuid);

create function public.cancel_open_card_order(p_order_id uuid, p_session text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'awaiting_payment' or v_order.payment_method <> 'card'
     or v_order.stripe_session_id is distinct from p_session then
    return false;
  end if;
  update public.product_variants v
  set stock = v.stock + i.quantity
  from public.order_items i
  where i.order_id = p_order_id and i.variant_id = v.id;
  update public.orders
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'by_shop'
  where id = p_order_id;
  return true;
end;
$$;

-- A cancelled order whose payment page is known to be closed and unpaid: there
-- is nothing left to ask Stripe about.
create or replace function public.close_card_session(p_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.orders set stripe_session_id = null
  where id = p_order_id and status = 'cancelled' and stripe_payment_intent is null;
$$;

-- The owner cancelled a paid card order: the whole amount went back to the
-- card. The order row is locked first, so two requests at once put the pieces
-- back once (they used to put them back twice).
create or replace function public.record_card_cancellation(p_order_id uuid, p_amount int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'paid' then
    return false;
  end if;
  update public.product_variants v
  set stock = v.stock + i.quantity
  from public.order_items i
  where i.order_id = p_order_id and i.variant_id = v.id;
  update public.orders
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'by_shop', refunded_cents = refunded_cents + p_amount
  where id = p_order_id;
  return true;
end;
$$;

-- Stripe says the card was charged. As before, plus 'duplicate': the order is
-- already paid and this is another payment for it (the caller sends it back).
create or replace function public.record_card_payment(
  p_order_id uuid, p_session_id text, p_payment_intent text, p_amount int, p_currency text,
  p_brand text, p_last4 text, p_livemode boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return 'not_found'; end if;
  if v_order.status = 'cancelled' then
    if v_order.stripe_payment_intent = p_payment_intent and v_order.refunded_cents >= p_amount then
      return 'refunded';
    end if;
    update public.orders
    set stripe_payment_intent = p_payment_intent, stripe_livemode = p_livemode, card_brand = p_brand, card_last4 = p_last4
    where id = p_order_id;
    return 'cancelled';
  end if;
  if v_order.stripe_payment_intent = p_payment_intent then
    return 'already_paid';
  end if;
  if v_order.status in ('paid', 'shipped', 'delivered') then
    return 'duplicate';
  end if;
  if p_amount <> v_order.total_cents or lower(p_currency) <> 'eur' then
    return 'mismatch';
  end if;
  update public.orders set
    status = 'paid', paid_at = now(), payment_method = 'card',
    stripe_session_id = p_session_id, stripe_payment_intent = p_payment_intent, stripe_livemode = p_livemode,
    card_brand = p_brand, card_last4 = p_last4
  where id = p_order_id;
  return 'paid';
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'cancel_open_card_order(uuid, text)',
    'close_card_session(uuid)',
    'record_card_cancellation(uuid, int)',
    'record_card_payment(uuid, text, text, int, text, text, text, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- A card order that Stripe can no longer be asked about (the keys were changed,
-- or card payments were switched off) used to stay unpaid for good, holding its
-- pieces: nothing could cancel it. A payment page lives 31 minutes, and the
-- order's deadline is set after the page's own, so:
-- * once the deadline has passed, the owner can cancel by a plain status change;
-- * six hours past it, the order cancels itself like any other unpaid order.
-- (A payment that turns out to have been made is refunded when Stripe's notice
-- or the customer's visit shows it.)
create or replace function public.cancel_overdue_orders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.orders
    where status = 'awaiting_payment' and payment_due_at < now()
      and (payment_method = 'bank_transfer' or stripe_session_id is null
           -- left half-way while a payment page was being replaced
           or stripe_session_id like 'replacing:%'
           -- nobody has been able to ask Stripe about it for hours
           or payment_due_at < now() - interval '6 hours')
    for update skip locked
  loop
    update public.product_variants v
    set stock = v.stock + i.quantity
    from public.order_items i
    where i.order_id = v_id and i.variant_id = v.id;

    update public.orders
    set status = 'cancelled', cancelled_at = now(), cancel_reason = 'not_paid'
    where id = v_id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.set_order_status(p_order_id uuid, p_status text, p_tracking text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_tracking text := trim(coalesce(p_tracking, ''));
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if p_status = 'paid' and v_order.status = 'awaiting_payment' then
    if v_order.payment_method = 'card' then
      -- Card orders are marked paid by Stripe, not by hand.
      raise exception using errcode = 'P0001', message = 'card_order';
    end if;
    update public.orders set status = 'paid', paid_at = now() where id = p_order_id returning * into v_order;
  elsif p_status = 'shipped' and v_order.status = 'paid' then
    update public.orders set status = 'shipped', shipped_at = now(), tracking_number = v_tracking
    where id = p_order_id returning * into v_order;
  elsif p_status = 'tracking' and v_order.status in ('shipped', 'delivered') then
    update public.orders set tracking_number = v_tracking where id = p_order_id returning * into v_order;
  elsif p_status = 'delivered' and v_order.status = 'shipped' then
    update public.orders set status = 'delivered', delivered_at = now() where id = p_order_id returning * into v_order;
  elsif p_status = 'cancelled' and v_order.status in ('awaiting_payment', 'paid') then
    if v_order.payment_method = 'card' and v_order.status = 'paid' then
      raise exception using errcode = 'P0001', message = 'card_refund_needed';
    end if;
    -- A payment page that may still be open is closed by the card-payment function, not here.
    -- Past the order's deadline no page can be open any more.
    if v_order.payment_method = 'card' and v_order.stripe_session_id is not null
       and (v_order.payment_due_at is null or v_order.payment_due_at > now()) then
      raise exception using errcode = 'P0001', message = 'card_page_open';
    end if;
    update public.product_variants v
    set stock = v.stock + i.quantity
    from public.order_items i
    where i.order_id = p_order_id and i.variant_id = v.id;
    update public.orders
    set status = 'cancelled', cancelled_at = now(), cancel_reason = 'by_shop'
    where id = p_order_id returning * into v_order;
  else
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds against returns: when nothing is left to refund, a refund of nothing closes the return
-- ---------------------------------------------------------------------------
-- (An order that was refunded too much before the cap existed left its other
-- returns impossible to close: "more than is left" was true even of zero.)
create or replace function public.update_return(
  p_return_id uuid,
  p_action text,
  p_note text default '',
  p_refund_cents int default null,
  p_restock boolean default false
)
returns public.returns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns;
  v_order public.orders;
  v_note text := trim(coalesce(p_note, ''));
  v_left int;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_return from public.returns where id = p_return_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if p_action = 'approve' and v_return.status = 'requested' then
    update public.returns set status = 'approved', shop_note = v_note, decided_at = now()
    where id = p_return_id returning * into v_return;
  elsif p_action = 'refuse' and v_return.status = 'requested' then
    if v_note = '' then
      raise exception using errcode = 'P0001', message = 'note_required';
    end if;
    update public.returns set status = 'refused', shop_note = v_note, decided_at = now()
    where id = p_return_id returning * into v_return;
  elsif p_action = 'refund' and v_return.status = 'approved' then
    -- The order row is locked, so two refunds of the same order go one after the other.
    select * into v_order from public.orders where id = v_return.order_id for update;
    if v_order.payment_method = 'card' then
      raise exception using errcode = 'P0001', message = 'card_order';
    end if;
    if p_refund_cents is null or p_refund_cents < 0 then
      raise exception using errcode = 'P0001', message = 'invalid_amount';
    end if;
    v_left := greatest(v_order.total_cents - v_order.refunded_cents, 0);
    if p_refund_cents > v_left then
      raise exception using errcode = 'P0001', message = 'refund_too_large', detail = v_left::text;
    end if;
    if p_restock then
      update public.product_variants v
      set stock = v.stock + ri.quantity
      from public.return_items ri
      join public.order_items oi on oi.id = ri.order_item_id
      where ri.return_id = p_return_id and oi.variant_id = v.id;
    end if;
    update public.orders set refunded_cents = refunded_cents + p_refund_cents where id = v_return.order_id;
    update public.returns
    set status = 'refunded', refund_cents = p_refund_cents, restocked = p_restock, refunded_at = now(),
        refund_method = 'bank_transfer'
    where id = p_return_id returning * into v_return;
  else
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  return v_return;
end;
$$;
