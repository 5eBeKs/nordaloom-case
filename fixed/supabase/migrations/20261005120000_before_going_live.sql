-- Before going live as a public demo: the newsletter could be made to email
-- anyone, orders without an account were limited only per email address while
-- the limit per visitor is off (proxy_hops = 0, the default), and (in the card
-- payment code, not here) the address a card payment returns to carried the
-- order's key for orders that belong to an account.

-- ---------------------------------------------------------------------------
-- New settings
-- ---------------------------------------------------------------------------
-- Limits for the whole shop. They work whatever proxy_hops says, because they
-- don't need to know who the visitor is.
-- * newsletter_signups_per_hour: new newsletter sign-ups in the last hour;
-- * guest_bank_orders_waiting: orders without an account waiting for a bank
--   transfer at the same time;
-- * guest_orders_per_hour: orders without an account placed in the last hour
--   that are unpaid, or were cancelled unpaid, however they were to be paid.
-- Visitors read only the settings columns granted to them by name (see
-- 20260930239000_after_the_check.sql), and these are not among them. The
-- owner's pages see them through admin_settings().
alter table public.shop_settings
  add column newsletter_signups_per_hour int not null default 20 check (newsletter_signups_per_hour >= 0),
  add column guest_bank_orders_waiting int not null default 15 check (guest_bank_orders_waiting >= 0),
  add column guest_orders_per_hour int not null default 20 check (guest_orders_per_hour >= 0);

revoke select (newsletter_signups_per_hour, guest_bank_orders_waiting, guest_orders_per_hour)
  on public.shop_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Newsletter sign-ups: through one function, and only so many
-- ---------------------------------------------------------------------------
-- Anyone could add rows to newsletter_subscribers directly, and every new row
-- sends the welcome email, with the welcome code, to the address typed in. A
-- script could make the shop email any number of strangers. Sign-ups now go
-- through subscribe_newsletter(), and the direct way in is closed.
drop policy "Anyone can subscribe" on public.newsletter_subscribers;
revoke insert on public.newsletter_subscribers from anon, authenticated;

-- Where a sign-up came from, for the limit per visitor: only a hash made with
-- the shop's own secret (see visitor_address()), never the address itself. In
-- a table nobody reaches through the API, and forgotten after a day.
create table public.newsletter_origins (
  subscriber_id uuid primary key references public.newsletter_subscribers (id) on delete cascade,
  address text not null,
  created_at timestamptz not null default now()
);
create index newsletter_origins_address_idx on public.newsletter_origins (address);
alter table public.newsletter_origins enable row level security;
-- No policies: nobody reaches this through the API.
revoke all on public.newsletter_origins from anon, authenticated;

select cron.schedule('forget-newsletter-origins', '23 * * * *', $$
  delete from public.newsletter_origins where created_at < now() - interval '1 day'
$$);

-- Answers 'subscribed' (the welcome email goes out) or 'already_subscribed'
-- (the same mailbox, whatever its letter case, spaces around it or a +tag:
-- nothing is sent). The address is kept as the mailbox, without the +tag, the
-- way place_order counts it ("name+1@" and "name+2@" are "name@"). Refuses
-- 'invalid_email', and 'too_many_signups' when:
-- * the limit per visitor is on (see proxy_hops) and this visitor has signed
--   up three new addresses in the last day (detail 'visitor');
-- * the shop has had newsletter_signups_per_hour new sign-ups in the last hour
--   (detail 'shop').
create or replace function public.subscribe_newsletter(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := regexp_replace(lower(trim(coalesce(p_email, ''))), '\+[^@]*@', '@');
  v_address text;
  v_id uuid;
begin
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception using errcode = 'P0001', message = 'invalid_email';
  end if;

  -- Already on the list: nothing more is sent, and nothing is counted.
  if exists (select 1 from public.newsletter_subscribers n where regexp_replace(lower(n.email), '\+[^@]*@', '@') = v_email) then
    return 'already_subscribed';
  end if;

  -- One sign-up at a time, so two at once can't both slip under a limit.
  perform pg_advisory_xact_lock(hashtext('newsletter'));

  v_address := public.visitor_address();
  if v_address is not null and (select count(*) from public.newsletter_origins g
      where g.address = v_address and g.created_at > now() - interval '1 day') >= 3 then
    raise exception using errcode = 'P0001', message = 'too_many_signups', detail = 'visitor';
  end if;
  if (select count(*) from public.newsletter_subscribers n where n.created_at > now() - interval '1 hour')
     >= (select s.newsletter_signups_per_hour from public.shop_settings s limit 1) then
    raise exception using errcode = 'P0001', message = 'too_many_signups', detail = 'shop';
  end if;

  insert into public.newsletter_subscribers (email) values (v_email)
  on conflict do nothing
  returning id into v_id;
  -- The same address arrived a moment earlier.
  if v_id is null then
    return 'already_subscribed';
  end if;
  if v_address is not null then
    insert into public.newsletter_origins (subscriber_id, address) values (v_id, v_address);
  end if;
  return 'subscribed';
end;
$$;

revoke all on function public.subscribe_newsletter(text) from public;
grant execute on function public.subscribe_newsletter(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- place_order: limits on orders without an account, for the whole shop
-- ---------------------------------------------------------------------------
-- With proxy_hops = 0 (the default, until the right number is known for the
-- host) the limit per visitor is off, and orders without an account were
-- limited only per email address, which a script changes at will: bank
-- transfer orders up to three per address, card orders not at all. Now, for
-- orders placed without an account, in the whole shop:
-- * at most guest_bank_orders_waiting (15) waiting for a bank transfer at
--   once: refused with 'too_many_guest_orders', detail 'bank_transfer';
-- * at most guest_orders_per_hour (20) placed in the last hour that are unpaid
--   or were cancelled unpaid, card or bank transfer: refused with
--   'too_many_guest_orders', detail 'hour'.
-- A signed-in customer is never refused by these: they are the way round them.
-- Orders of the made-up history (demo_people) are not counted: loaded, it
-- has guest orders waiting for a transfer that would take most of the room.
-- The rest of place_order is as it was (20260930239500_after_the_fix_review.sql).
create index orders_guest_created_idx on public.orders (created_at) where user_id is null;

create or replace function public.place_order(
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
  -- Orders without an account, counted for the whole shop (also with proxy_hops = 0).
  -- One at a time, so two at once can't both slip under a limit.
  if auth.uid() is null then
    perform pg_advisory_xact_lock(hashtext('unpaid:guests'));
    select * into v_settings from public.shop_settings limit 1;
    if place_order.payment_method = 'bank_transfer'
       and (select count(*) from public.orders o
            where o.user_id is null and o.status = 'awaiting_payment' and o.payment_method = 'bank_transfer'
              and not exists (select 1 from public.demo_people d where d.email = lower(o.email)))
           >= v_settings.guest_bank_orders_waiting then
      raise exception using errcode = 'P0001', message = 'too_many_guest_orders', detail = 'bank_transfer';
    end if;
    if (select count(*) from public.orders o
        where o.user_id is null and o.created_at > now() - interval '1 hour' and o.paid_at is null
          and o.status in ('awaiting_payment', 'cancelled')
          and not exists (select 1 from public.demo_people d where d.email = lower(o.email))) >= v_settings.guest_orders_per_hour then
      raise exception using errcode = 'P0001', message = 'too_many_guest_orders', detail = 'hour';
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
-- Switching a card order to bank transfer: the same limit for the whole shop
-- ---------------------------------------------------------------------------
-- Otherwise orders without an account could be placed as card orders (which
-- the limit on bank transfers lets through) and switched one after another
-- into any number of orders waiting for a transfer. Counted as in place_order.
-- Answers 'switched', 'not_switchable', 'too_many_unpaid' or, new,
-- 'too_many_guest_orders'.
create or replace function public.switch_to_bank_transfer(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_mailbox text;
  v_own_email boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'awaiting_payment' or v_order.payment_method <> 'card' then
    return 'not_switchable';
  end if;
  v_mailbox := regexp_replace(lower(v_order.email), '\+[^@]*@', '@');
  v_own_email := v_order.user_id is not null
    and exists (select 1 from auth.users u where u.id = v_order.user_id and lower(u.email) = lower(v_order.email));
  if not v_own_email then
    perform pg_advisory_xact_lock(hashtext('unpaid:' || v_mailbox));
    if (select count(*) from public.orders o
        where o.status = 'awaiting_payment' and o.payment_method = 'bank_transfer'
          and regexp_replace(lower(o.email), '\+[^@]*@', '@') = v_mailbox) >= 3 then
      return 'too_many_unpaid';
    end if;
  end if;
  if v_order.user_id is null then
    perform pg_advisory_xact_lock(hashtext('unpaid:guests'));
    if (select count(*) from public.orders o
        where o.user_id is null and o.status = 'awaiting_payment' and o.payment_method = 'bank_transfer'
          and not exists (select 1 from public.demo_people d where d.email = lower(o.email)))
       >= (select s.guest_bank_orders_waiting from public.shop_settings s limit 1) then
      return 'too_many_guest_orders';
    end if;
  end if;
  update public.orders set
    payment_method = 'bank_transfer', stripe_session_id = null,
    payment_due_at = now() + make_interval(days => (select payment_days from public.shop_settings limit 1))
  where id = p_order_id;
  perform public.queue_order_email(p_order_id, 'order_confirmation');
  return 'switched';
end;
$$;

revoke all on function public.switch_to_bank_transfer(uuid) from public, anon, authenticated;
grant execute on function public.switch_to_bank_transfer(uuid) to service_role;
