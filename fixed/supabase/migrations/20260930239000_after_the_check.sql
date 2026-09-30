-- Fixes after the shop was checked (see tests/): the order-once key, the amount
-- the customer agreed to, limits on unpaid orders, refunds no larger than what
-- was paid, card payments on cancelled orders, the email when the shop cancels
-- an order, codes from the made-up history, the settings a visitor can read,
-- and what a customer has spent.

-- ---------------------------------------------------------------------------
-- Settings: visitors read only what the shop pages show
-- ---------------------------------------------------------------------------
-- How many proxies stand between a visitor and the database's API. The visitor's
-- address is taken that many entries from the end of X-Forwarded-For (the last
-- entry is written by the nearest proxy; anything before the trusted ones can be
-- made up by the visitor). Local Supabase and a plain hosted project: 1.
alter table public.shop_settings
  add column proxy_hops int not null default 1 check (proxy_hops between 1 and 5);

revoke select on public.shop_settings from anon, authenticated;
grant select (id, free_shipping_threshold_cents, payment_days, return_days, return_address, low_stock_threshold, contact_email)
  on public.shop_settings to anon, authenticated;

-- The owner's pages read the rest through this.
create or replace function public.admin_settings()
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
  return (select to_jsonb(s) from public.shop_settings s limit 1);
end;
$$;

revoke all on function public.admin_settings() from public, anon;
grant execute on function public.admin_settings() to authenticated;

-- ---------------------------------------------------------------------------
-- Who is ordering (for the limits on unpaid orders)
-- ---------------------------------------------------------------------------
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
  v_hops int := (select proxy_hops from public.shop_settings limit 1);
begin
  begin
    v_header := nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for';
  exception when others then
    return null;
  end;
  v_list := string_to_array(replace(coalesce(v_header, ''), ' ', ''), ',');
  if coalesce(array_length(v_list, 1), 0) < v_hops then
    return null;
  end if;
  return nullif(v_list[array_length(v_list, 1) - v_hops + 1], '');
end;
$$;

revoke all on function public.visitor_address() from public, anon, authenticated;

-- A fingerprint of the address an order without an account was placed from.
-- Kept only while the order is unpaid (that is all the limit counts).
alter table public.orders add column placed_from text;
create index orders_placed_from_idx on public.orders (placed_from) where placed_from is not null;

create or replace function public.orders_forget_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'awaiting_payment' then
    new.placed_from := null;
  end if;
  return new;
end;
$$;

create trigger orders_forget_address
  before update of status on public.orders
  for each row execute function public.orders_forget_address();

-- ---------------------------------------------------------------------------
-- place_order
-- ---------------------------------------------------------------------------
-- * The order-once key now stands for one exact order by one person: the same
--   key with another bag, other details or another account is a new order,
--   never someone else's order handed back. (An order placed before this
--   change and sent again after it would be made a second time; the window is
--   the few minutes around the update.)
-- * expected_total_cents: the total the customer saw on the button. If the
--   shop's total is different (a price or a code changed meanwhile), nothing
--   is ordered and the new total comes back, so the customer can agree to it.
-- * Unpaid orders are limited: three per email address, five per account, and
--   five a day per visitor without an account.
-- * The price of each piece is read once, with its row locked, and that same
--   price goes into the order's lines and its total.
drop function public.place_order(jsonb, jsonb, text, text, text, text, uuid);

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
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception using errcode = 'P0001', message = 'empty_cart';
  end if;

  -- The same checkout sent again (a double tap, or a retry after the connection
  -- dropped): hand back the order it already made instead of making another.
  -- "The same" means the same key, person, bag, details and way of paying.
  if client_key is not null then
    v_key := md5(concat_ws('|',
      client_key::text, coalesce(auth.uid()::text, ''), v_email, v_name, v_phone, v_country, v_line1, v_line2, v_city, v_postal,
      coalesce(shipping_code, ''), v_locker, v_code_text, coalesce(payment_method, ''),
      (select string_agg(x.variant_id || ':' || x.quantity, ',' order by x.variant_id)
       from (select e ->> 'variant_id' as variant_id, sum((e ->> 'quantity')::int) as quantity
             from jsonb_array_elements(items) e group by 1) x)
    ))::uuid;
    -- Two copies arriving at the same moment: the second waits for the first.
    perform pg_advisory_xact_lock(hashtext(v_key::text));
    select * into v_order from public.orders o where o.client_key = v_key;
    if found and v_order.created_at > now() - interval '1 day' then
      return jsonb_build_object('order_number', v_order.order_number, 'access_token', v_order.access_token,
                                'payment_method', v_order.payment_method, 'already_placed', true);
    end if;
    -- An old key (the same attempt from days ago): this is a new order.
    if found then v_key := null; end if;
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
  -- many at a time. One at a time per address / account / visitor, so two
  -- requests at once can't both slip under the limit.
  perform pg_advisory_xact_lock(hashtext('unpaid:' || v_email));
  if (select count(*) from public.orders o where o.status = 'awaiting_payment' and lower(o.email) = v_email) >= 3 then
    raise exception using errcode = 'P0001', message = 'too_many_unpaid';
  end if;
  if auth.uid() is not null then
    perform pg_advisory_xact_lock(hashtext('unpaid:' || auth.uid()::text));
    if (select count(*) from public.orders o where o.status = 'awaiting_payment' and o.user_id = auth.uid()) >= 5 then
      raise exception using errcode = 'P0001', message = 'too_many_orders';
    end if;
  else
    v_address := md5('nordaloom:' || public.visitor_address());
    if v_address is not null then
      perform pg_advisory_xact_lock(hashtext('unpaid:' || v_address));
      if (select count(*) from public.orders o
          where o.status = 'awaiting_payment' and o.placed_from = v_address and o.created_at > now() - interval '1 day') >= 5 then
        raise exception using errcode = 'P0001', message = 'too_many_orders';
      end if;
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
    payment_method, payment_due_at, client_key, placed_from
  ) values (
    auth.uid(), v_email, v_name, v_phone, v_country, v_line1, v_line2, v_city, v_postal,
    v_rate.code, v_rate.label, v_locker, v_subtotal, v_shipping, v_total,
    round(v_total - v_total / 1.21)::int,
    '', v_code.id, v_code.code, v_discount,
    place_order.payment_method,
    -- Card: the pieces are held while the customer is on the payment page (see set_card_session).
    case when place_order.payment_method = 'card' then now() + interval '40 minutes' end,
    v_key, v_address
  )
  returning * into v_order;

  update public.orders set payment_reference = order_number where id = v_order.id
  returning * into v_order;

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
-- Refunds recorded against returns: never more than is left of what was paid
-- ---------------------------------------------------------------------------
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
    if p_refund_cents > v_order.total_cents - v_order.refunded_cents then
      raise exception using errcode = 'P0001', message = 'refund_too_large',
        detail = greatest(v_order.total_cents - v_order.refunded_cents, 0)::text;
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

-- ---------------------------------------------------------------------------
-- Card payments and cancelled orders
-- ---------------------------------------------------------------------------
-- Stripe says the card was charged. Returns what happened: 'paid',
-- 'already_paid', 'mismatch', 'cancelled' (the order is cancelled and the money
-- has not gone back yet: the caller refunds it, however many times it takes)
-- or 'refunded' (cancelled, and the money has gone back).
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
  if v_order.stripe_payment_intent = p_payment_intent or v_order.status in ('paid', 'shipped', 'delivered') then
    return 'already_paid';
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

-- The refund of a payment that arrived after its order was cancelled. Safe to
-- record more than once; the customer is told once.
create or replace function public.record_late_payment_refund(p_order_id uuid, p_amount int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.orders set refunded_cents = greatest(refunded_cents, p_amount)
  where id = p_order_id and status = 'cancelled';
  if found then
    perform public.queue_order_email(p_order_id, 'payment_returned');
  end if;
end;
$$;

-- The owner cancels a card order nobody has paid for. Only the card-payment
-- function calls this, after it has closed the order's payment page at Stripe.
create or replace function public.cancel_open_card_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'awaiting_payment' or v_order.payment_method <> 'card' then
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

do $$
declare f text;
begin
  foreach f in array array[
    'record_card_payment(uuid, text, text, int, text, text, text, boolean)',
    'record_late_payment_refund(uuid, int)',
    'cancel_open_card_order(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- A card order whose payment page may still be open is cancelled through the
-- card-payment function (which closes the page first), not by a plain status change.
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
    if v_order.payment_method = 'card' and v_order.stripe_session_id is not null then
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
-- Emails: every cancellation is told to the customer, and so is a returned payment
-- ---------------------------------------------------------------------------
alter table public.emails drop constraint emails_kind_check;
alter table public.emails add constraint emails_kind_check check (kind in (
  'order_confirmation', 'payment_reminder', 'order_cancelled', 'payment_received', 'payment_returned', 'order_shipped', 'order_delivered',
  'return_approved', 'return_refused', 'refund_sent', 'newsletter_welcome', 'password_reset'));

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
  elsif new.status = 'cancelled' then
    -- Not paid in time, or cancelled by the shop: the template says which, and what happens to any money.
    perform public.queue_order_email(new.id, 'order_cancelled');
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Codes that belong to the made-up history
-- ---------------------------------------------------------------------------
-- They exist so the history's orders have something to point at; no real
-- customer can use one. (scripts/demo-history.mjs now creates them paused.)
update public.discount_codes set is_active = false where code in (select code from public.demo_codes);

-- Removing the history keeps a code that a real order has used (paused), and
-- removes the rest, instead of stopping.
create or replace function public.remove_demo_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orders int;
  v_users int;
  v_subs int;
  v_msgs int;
  v_codes int;
  v_stock int;
  v_loaded timestamptz := (select loaded_at from public.demo_meta);
begin
  -- Stock first: undo what the history changed when it was loaded, and what
  -- its orders have put back on the shelf since (unpaid ones cancelling
  -- themselves, returns restocked).
  with since as (
    select i.variant_id, sum(i.quantity) as q
    from public.orders o join public.order_items i on i.order_id = o.id
    where lower(o.email) in (select email from public.demo_people)
      and o.status = 'cancelled' and o.cancelled_at > v_loaded
    group by 1
    union all
    select i.variant_id, sum(ri.quantity)
    from public.returns r
    join public.orders o on o.id = r.order_id
    join public.return_items ri on ri.return_id = r.id
    join public.order_items i on i.id = ri.order_item_id
    where lower(o.email) in (select email from public.demo_people)
      and r.restocked and r.refunded_at > v_loaded
    group by 1
  ),
  total as (
    select variant_id, sum(change) as change from (
      select variant_id, change from public.demo_stock_change
      union all
      select variant_id, q from since
    ) x group by 1
  )
  update public.product_variants v
  set stock = greatest(0, v.stock - t.change)
  from total t
  where t.variant_id = v.id and t.change <> 0;
  get diagnostics v_stock = row_count;

  delete from public.orders where lower(email) in (select email from public.demo_people);
  get diagnostics v_orders = row_count;
  delete from public.emails where lower(to_email) in (select email from public.demo_people);
  delete from public.newsletter_subscribers where lower(email) in (select email from public.demo_people);
  get diagnostics v_subs = row_count;
  delete from public.contact_messages where lower(email) in (select email from public.demo_people);
  get diagnostics v_msgs = row_count;
  -- Accounts (their profiles, reviews, wish lists and bags go with them).
  delete from auth.users where lower(email) in (select email from public.demo_people);
  get diagnostics v_users = row_count;
  -- The history's orders are gone; a code that is still used belongs to a real order and stays, paused.
  delete from public.discount_codes d
  where d.code in (select code from public.demo_codes)
    and not exists (select 1 from public.orders o where o.discount_code_id = d.id);
  get diagnostics v_codes = row_count;
  update public.discount_codes set is_active = false where code in (select code from public.demo_codes);

  truncate public.demo_people, public.demo_stock_change, public.demo_codes, public.demo_meta;
  return jsonb_build_object('orders', v_orders, 'accounts', v_users, 'newsletter', v_subs,
                            'messages', v_msgs, 'codes', v_codes, 'variants_restocked', v_stock);
end;
$$;

revoke all on function public.remove_demo_history() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Customers: money that was refunded is not money spent
-- ---------------------------------------------------------------------------
create or replace function public.admin_customers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  with accounts as (
    select lower(u.email) as key, u.id as user_id, u.created_at as registered_at, p.full_name
    from auth.users u
    join public.profiles p on p.id = u.id
    where p.role = 'customer' and u.email is not null
  ),
  guests as (
    select distinct lower(o.email) as key
    from public.orders o
    where o.user_id is null and lower(o.email) not in (select key from accounts)
  ),
  people as (
    select key, user_id, registered_at, full_name from accounts
    union all
    select key, null::uuid, null::timestamptz, null::text from guests
  ),
  summary as (
    select pe.key, pe.user_id, pe.registered_at, pe.full_name,
           count(o.id) filter (where o.status <> 'cancelled') as orders,
           coalesce(sum(greatest(o.total_cents - o.refunded_cents, 0)) filter (where o.status in ('paid', 'shipped', 'delivered')), 0) as spent_cents,
           coalesce(sum(o.refunded_cents), 0) as refunded_cents,
           max(o.created_at) as last_order_at
    from people pe
    left join public.orders o
      on o.user_id = pe.user_id or (o.user_id is null and lower(o.email) = pe.key)
    group by pe.key, pe.user_id, pe.registered_at, pe.full_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'email', s.key,
    'user_id', s.user_id,
    'registered_at', s.registered_at,
    'name', coalesce(s.full_name, lo.full_name),
    'country', lo.country,
    'orders', s.orders,
    'spent_cents', s.spent_cents,
    'refunded_cents', s.refunded_cents,
    'last_order_at', s.last_order_at,
    'newsletter', exists (select 1 from public.newsletter_subscribers n where lower(n.email) = s.key)
  ) order by s.last_order_at desc nulls last, s.registered_at desc nulls last), '[]'::jsonb)
  into v_result
  from summary s
  left join lateral (
    select o.full_name, o.country from public.orders o
    where o.user_id = s.user_id or (o.user_id is null and lower(o.email) = s.key)
    order by o.created_at desc limit 1
  ) lo on true;

  return v_result;
end;
$$;
