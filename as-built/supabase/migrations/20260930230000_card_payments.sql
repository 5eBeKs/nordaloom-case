-- Card payments through Stripe, next to bank transfer.
--
-- A card order is placed like any other (stock is taken at once), then the
-- card-payment server function opens a Stripe Checkout page for it. The order
-- becomes 'paid' when Stripe confirms the payment -- learned from the customer
-- coming back, from Stripe's webhook, or from a check every two minutes,
-- whichever is first. If the payment page expires unpaid (30 minutes), the
-- order is cancelled and the pieces go back on the shelf. Refunds for card
-- orders go back to the card, from the admin.

-- ---------------------------------------------------------------------------
-- Orders and returns
-- ---------------------------------------------------------------------------
alter table public.orders
  add column payment_method text not null default 'bank_transfer' check (payment_method in ('bank_transfer', 'card')),
  add column stripe_session_id text,
  add column stripe_payment_intent text,
  add column stripe_livemode boolean,
  add column card_brand text,
  add column card_last4 text,
  -- Everything given back to the card so far (returns and cancellations).
  add column refunded_cents int not null default 0 check (refunded_cents >= 0);

create index orders_card_open_idx on public.orders (created_at)
  where payment_method = 'card' and status = 'awaiting_payment';

alter table public.returns
  add column refund_method text check (refund_method in ('bank_transfer', 'card')),
  add column stripe_refund_id text;

-- ---------------------------------------------------------------------------
-- Placing an order, with the payment method
-- ---------------------------------------------------------------------------
drop function public.place_order(jsonb, jsonb, text, text, text);

create function public.place_order(
  items jsonb,
  customer jsonb,
  shipping_code text,
  parcel_locker text default '',
  discount_code text default null,
  payment_method text default 'bank_transfer'
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
    payment_reference, discount_code_id, discount_code, discount_cents,
    payment_method, payment_due_at
  ) values (
    auth.uid(), v_email, v_name, v_phone, v_country, v_line1, v_line2, v_city, v_postal,
    v_rate.code, v_rate.label, v_locker, v_subtotal, v_shipping, v_total,
    round(v_total - v_total / 1.21)::int,
    '', v_code.id, v_code.code, v_discount,
    place_order.payment_method,
    -- Card: the pieces are held while the customer is on the payment page (see set_card_session).
    case when place_order.payment_method = 'card' then now() + interval '40 minutes' end
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

  return jsonb_build_object('order_number', v_order.order_number, 'access_token', v_order.access_token, 'payment_method', v_order.payment_method);
end;
$$;

revoke all on function public.place_order(jsonb, jsonb, text, text, text, text) from public;
grant execute on function public.place_order(jsonb, jsonb, text, text, text, text) to anon, authenticated;

-- The confirmation email with bank details is only for bank transfer orders;
-- card orders get "payment received" once the card is charged.
create or replace function public.email_on_order_placed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_method = 'bank_transfer' then
    perform public.queue_order_email(new.id, 'order_confirmation');
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unpaid orders
-- ---------------------------------------------------------------------------
-- Bank transfers: cancelled after the deadline, as before. Card orders are
-- only cancelled here if no payment page was ever opened for them; otherwise
-- Stripe decides (see cancel_unpaid_card_order), because a payment might
-- still be completing.
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
           or stripe_session_id like 'replacing:%')
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

-- ---------------------------------------------------------------------------
-- The card-payment server function's side (service role only)
-- ---------------------------------------------------------------------------

-- A payment page was opened: hold the pieces until it expires (plus a margin).
create or replace function public.set_card_session(p_order_id uuid, p_session_id text, p_expires_at timestamptz)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.orders
  set stripe_session_id = p_session_id, payment_due_at = p_expires_at + interval '5 minutes'
  where id = p_order_id and status = 'awaiting_payment' and payment_method = 'card'
  returning true;
$$;

-- Stripe says the card was charged. Returns what happened:
-- 'paid', 'already_paid', 'cancelled' (the caller refunds it) or 'mismatch'.
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
  if v_order.stripe_payment_intent = p_payment_intent or v_order.status in ('paid', 'shipped', 'delivered') then
    return 'already_paid';
  end if;
  if v_order.status = 'cancelled' then
    update public.orders set stripe_payment_intent = p_payment_intent, stripe_livemode = p_livemode where id = p_order_id;
    return 'cancelled';
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

-- The payment page expired (or was closed for good) without a payment.
create or replace function public.cancel_unpaid_card_order(p_order_id uuid, p_session_id text)
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
     or v_order.stripe_session_id is distinct from p_session_id then
    return false;
  end if;
  update public.product_variants v
  set stock = v.stock + i.quantity
  from public.order_items i
  where i.order_id = p_order_id and i.variant_id = v.id;
  update public.orders
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'not_paid'
  where id = p_order_id;
  return true;
end;
$$;

-- The customer chose to pay by bank transfer after all (after the open
-- payment page has been closed). They get the usual deadline and the
-- confirmation email with the bank details.
create or replace function public.switch_to_bank_transfer(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.orders set
    payment_method = 'bank_transfer', stripe_session_id = null,
    payment_due_at = now() + make_interval(days => (select payment_days from public.shop_settings limit 1))
  where id = p_order_id and status = 'awaiting_payment' and payment_method = 'card';
  if not found then return false; end if;
  perform public.queue_order_email(p_order_id, 'order_confirmation');
  return true;
end;
$$;

-- A return refunded to the card (the refund itself was made at Stripe).
create or replace function public.record_card_refund(p_return_id uuid, p_amount int, p_refund_id text, p_restock boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns;
begin
  select * into v_return from public.returns where id = p_return_id for update;
  if not found or v_return.status <> 'approved' then return false; end if;
  if p_restock then
    update public.product_variants v
    set stock = v.stock + ri.quantity
    from public.return_items ri
    join public.order_items oi on oi.id = ri.order_item_id
    where ri.return_id = p_return_id and oi.variant_id = v.id;
  end if;
  update public.orders set refunded_cents = refunded_cents + p_amount where id = v_return.order_id;
  update public.returns
  set status = 'refunded', refund_cents = p_amount, restocked = p_restock, refunded_at = now(),
      refund_method = 'card', stripe_refund_id = p_refund_id
  where id = p_return_id;
  return true;
end;
$$;

-- The owner cancelled a paid card order: the whole amount went back to the card.
create or replace function public.record_card_cancellation(p_order_id uuid, p_amount int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.product_variants v
  set stock = v.stock + i.quantity
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where i.order_id = p_order_id and i.variant_id = v.id and o.status = 'paid';
  update public.orders
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'by_shop', refunded_cents = refunded_cents + p_amount
  where id = p_order_id and status = 'paid';
  return found;
end;
$$;

-- An automatic refund of a payment that arrived after its order was cancelled.
create or replace function public.record_late_payment_refund(p_order_id uuid, p_amount int)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.orders set refunded_cents = refunded_cents + p_amount where id = p_order_id;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'set_card_session(uuid, text, timestamptz)',
    'record_card_payment(uuid, text, text, int, text, text, text, boolean)',
    'cancel_unpaid_card_order(uuid, text)',
    'switch_to_bank_transfer(uuid)',
    'record_card_refund(uuid, int, text, boolean)',
    'record_card_cancellation(uuid, int)',
    'record_late_payment_refund(uuid, int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Owner cancelling a paid card order must go through the card-payment function
-- (so the money goes back); the plain status change refuses it.
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

-- Card orders are refunded through the card-payment function, not marked by hand.
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
    if (select payment_method from public.orders where id = v_return.order_id) = 'card' then
      raise exception using errcode = 'P0001', message = 'card_order';
    end if;
    if p_refund_cents is null or p_refund_cents < 0 then
      raise exception using errcode = 'P0001', message = 'invalid_amount';
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

-- Return emails know how the money goes back.
create or replace function public.email_on_return_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_order jsonb;
  v_data jsonb;
begin
  if new.status = old.status then return null; end if;
  v_kind := case new.status when 'approved' then 'return_approved' when 'refused' then 'return_refused' when 'refunded' then 'refund_sent' end;
  if v_kind is null then return null; end if;

  v_order := public.order_email_data(new.order_id);
  v_data := v_order || jsonb_build_object(
    'return', jsonb_build_object(
      'return_number', new.return_number, 'status', new.status, 'reason', new.reason, 'details', new.details,
      'shop_note', new.shop_note, 'refund_cents', new.refund_cents, 'refund_method', new.refund_method,
      'created_at', new.created_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('name', i.product_name, 'colour', i.colour, 'size', i.size, 'quantity', ri.quantity, 'image', i.product_image))
        from public.return_items ri join public.order_items i on i.id = ri.order_item_id
        where ri.return_id = new.id), '[]'::jsonb)),
    'return_address', (select return_address from public.shop_settings limit 1)
  );

  insert into public.emails (kind, to_email, to_name, order_id, return_id, data, dedupe_key)
  values (v_kind, v_order ->> 'email', v_order ->> 'full_name', new.order_id, new.id, v_data, v_kind || ':' || new.id)
  on conflict (dedupe_key) do nothing;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checking open card payments with Stripe every two minutes
-- ---------------------------------------------------------------------------
create or replace function public.wake_card_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := (select functions_url from public.shop_settings limit 1) || '/card-payment',
    body := '{"action": "sync"}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.wake_card_sync() from public, anon, authenticated;

select cron.schedule('sync-card-payments', '*/2 * * * *', $$
  select public.wake_card_sync()
  where exists (
    select 1 from public.orders
    where payment_method = 'card' and status = 'awaiting_payment' and stripe_session_id is not null
  )
$$);

-- Payment reminders are for bank transfers only (a card order is held for minutes, not days).
create or replace function public.queue_payment_reminders()
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
    select o.id from public.orders o
    where o.status = 'awaiting_payment'
      and o.payment_method = 'bank_transfer'
      and now() >= o.payment_due_at - interval '2 days'
      and now() < o.payment_due_at
      and not exists (select 1 from public.emails e where e.dedupe_key = 'payment_reminder:' || o.id)
  loop
    perform public.queue_order_email(v_id, 'payment_reminder');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
