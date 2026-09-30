-- Placing an order safely more than once. The checkout sends a random key
-- with each attempt to order; if the same key arrives again (the customer
-- taps twice, or the phone retries after losing its connection mid-way), the
-- order that was already made is returned instead of a second one.

alter table public.orders add column client_key uuid unique;

drop function public.place_order(jsonb, jsonb, text, text, text, text);

create function public.place_order(
  items jsonb,
  customer jsonb,
  shipping_code text,
  parcel_locker text default '',
  discount_code text default null,
  payment_method text default 'bank_transfer',
  client_key uuid default null
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
  -- The same checkout sent again (a double tap, or a retry after the connection
  -- dropped): hand back the order it already made instead of making another.
  if client_key is not null then
    -- Two copies arriving at the same moment: the second waits for the first.
    perform pg_advisory_xact_lock(hashtext(place_order.client_key::text));
    select * into v_order from public.orders o where o.client_key = place_order.client_key;
    if found and v_order.created_at > now() - interval '1 day' then
      return jsonb_build_object('order_number', v_order.order_number, 'access_token', v_order.access_token,
                                'payment_method', v_order.payment_method, 'already_placed', true);
    end if;
    -- An old key (an attempt from days ago): this is a new order.
    if found then client_key := null; end if;
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
    payment_method, payment_due_at, client_key
  ) values (
    auth.uid(), v_email, v_name, v_phone, v_country, v_line1, v_line2, v_city, v_postal,
    v_rate.code, v_rate.label, v_locker, v_subtotal, v_shipping, v_total,
    round(v_total - v_total / 1.21)::int,
    '', v_code.id, v_code.code, v_discount,
    place_order.payment_method,
    -- Card: the pieces are held while the customer is on the payment page (see set_card_session).
    case when place_order.payment_method = 'card' then now() + interval '40 minutes' end,
    place_order.client_key
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

revoke all on function public.place_order(jsonb, jsonb, text, text, text, text, uuid) from public;
grant execute on function public.place_order(jsonb, jsonb, text, text, text, text, uuid) to anon, authenticated;
