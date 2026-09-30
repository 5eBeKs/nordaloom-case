-- Admin area: return address, tracking numbers, dashboard figures, customers,
-- product editing and safe stock edits. Every function here is owner-only.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.shop_settings
  add column return_address text not null default '',
  add column low_stock_threshold int not null default 2 check (low_stock_threshold >= 0);

update public.shop_settings
set return_address = E'Nordaloom SIA\nLiela iela 12\nKuldiga, LV-3301\nLatvia',
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Tracking numbers
-- ---------------------------------------------------------------------------
alter table public.orders add column tracking_number text not null default ''
  check (length(tracking_number) <= 100);

drop function public.set_order_status(uuid, text);

create function public.set_order_status(p_order_id uuid, p_status text, p_tracking text default null)
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
    update public.orders set status = 'paid', paid_at = now() where id = p_order_id returning * into v_order;
  elsif p_status = 'shipped' and v_order.status = 'paid' then
    update public.orders set status = 'shipped', shipped_at = now(), tracking_number = v_tracking
    where id = p_order_id returning * into v_order;
  elsif p_status = 'tracking' and v_order.status in ('shipped', 'delivered') then
    -- Correct or add the tracking number after shipping.
    update public.orders set tracking_number = v_tracking where id = p_order_id returning * into v_order;
  elsif p_status = 'delivered' and v_order.status = 'shipped' then
    update public.orders set status = 'delivered', delivered_at = now() where id = p_order_id returning * into v_order;
  elsif p_status = 'cancelled' and v_order.status in ('awaiting_payment', 'paid') then
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

revoke all on function public.set_order_status(uuid, text, text) from public;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard. "Sales" are orders that have been paid (paid, shipped or
-- delivered), counted on the day they were placed, in Latvian time.
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Riga')::date;
  v_threshold int;
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select low_stock_threshold into v_threshold from public.shop_settings limit 1;

  with sold as (
    select o.*, (o.created_at at time zone 'Europe/Riga')::date as day
    from public.orders o
    where o.status in ('paid', 'shipped', 'delivered')
  )
  select jsonb_build_object(
    'daily', (
      select jsonb_agg(jsonb_build_object('date', d::date, 'sales_cents', coalesce(s.sales, 0), 'orders', coalesce(s.n, 0)) order by d)
      from generate_series(v_today - 29, v_today, interval '1 day') d
      left join (select day, sum(total_cents) sales, count(*) n from sold group by day) s on s.day = d::date
    ),
    'monthly', (
      select jsonb_agg(jsonb_build_object('month', m::date, 'sales_cents', coalesce(s.sales, 0), 'orders', coalesce(s.n, 0)) order by m)
      from generate_series(date_trunc('month', v_today) - interval '11 months', date_trunc('month', v_today), interval '1 month') m
      left join (select date_trunc('month', day) mon, sum(total_cents) sales, count(*) n from sold group by 1) s on s.mon = m
    ),
    'last30', (
      select jsonb_build_object('sales_cents', coalesce(sum(total_cents), 0), 'orders', count(*))
      from sold where day > v_today - 30
    ),
    'previous30', (
      select jsonb_build_object('sales_cents', coalesce(sum(total_cents), 0), 'orders', count(*))
      from sold where day > v_today - 60 and day <= v_today - 30
    ),
    'all_time', (
      select jsonb_build_object('sales_cents', coalesce(sum(total_cents), 0), 'orders', count(*)) from sold
    ),
    'refunded_30d_cents', (
      select coalesce(sum(refund_cents), 0) from public.returns
      where status = 'refunded' and refunded_at > now() - interval '30 days'
    ),
    'best_sellers', (
      select coalesce(jsonb_agg(b order by b.pieces desc, b.sales_cents desc), '[]'::jsonb) from (
        select i.product_slug, max(i.product_name) as product_name, max(i.product_image) as product_image,
               sum(i.quantity)::int as pieces, sum(i.line_total_cents)::int as sales_cents
        from public.order_items i
        join sold o on o.id = i.order_id
        where o.day > v_today - 90
        group by i.product_slug
        order by pieces desc, sales_cents desc
        limit 6
      ) b
    ),
    'low_stock', (
      select coalesce(jsonb_agg(l order by l.stock, l.product_name), '[]'::jsonb) from (
        select p.id as product_id, p.name as product_name, p.images[1] as product_image,
               v.id as variant_id, v.colour, v.size, v.stock
        from public.product_variants v
        join public.products p on p.id = v.product_id
        where p.is_published and v.stock <= v_threshold
        order by v.stock, p.name
        limit 12
      ) l
    ),
    'low_stock_count', (
      select count(*) from public.product_variants v join public.products p on p.id = v.product_id
      where p.is_published and v.stock <= v_threshold
    ),
    'low_stock_threshold', v_threshold,
    'waiting', jsonb_build_object(
      'to_ship', (select count(*) from public.orders where status = 'paid'),
      'awaiting_payment', (select count(*) from public.orders where status = 'awaiting_payment'),
      'in_transit', (select count(*) from public.orders where status = 'shipped'),
      'returns_to_decide', (select count(*) from public.returns where status = 'requested'),
      'returns_to_refund', (select count(*) from public.returns where status = 'approved')
    ),
    'recent_orders', (
      select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
        select order_number, full_name, total_cents, status, created_at
        from public.orders order by created_at desc limit 6
      ) r
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_dashboard() from public;
grant execute on function public.admin_dashboard() to authenticated;

-- ---------------------------------------------------------------------------
-- Customers: everyone with an account, plus people who ordered as guests.
-- A customer is identified by their email address.
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
           coalesce(sum(o.total_cents) filter (where o.status in ('paid', 'shipped', 'delivered')), 0) as spent_cents,
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

revoke all on function public.admin_customers() from public;
grant execute on function public.admin_customers() to authenticated;

create or replace function public.admin_customer(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := lower(trim(p_email));
  v_user auth.users;
  v_name text;
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  select * into v_user from auth.users u where lower(u.email) = v_key;
  select full_name into v_name from public.profiles where id = v_user.id;

  select jsonb_build_object(
    'email', v_key,
    'user_id', v_user.id,
    'registered_at', v_user.created_at,
    'last_sign_in_at', v_user.last_sign_in_at,
    'name', coalesce(v_name, (select o.full_name from public.orders o where lower(o.email) = v_key order by created_at desc limit 1)),
    'newsletter', exists (select 1 from public.newsletter_subscribers n where lower(n.email) = v_key),
    'addresses', coalesce((
      select jsonb_agg(to_jsonb(a) - 'user_id' order by a.is_default desc, a.created_at)
      from public.customer_addresses a where a.user_id = v_user.id
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(
        (to_jsonb(o) - 'access_token') || jsonb_build_object(
          'items', (select coalesce(jsonb_agg(to_jsonb(i) - 'order_id' order by i.product_name), '[]'::jsonb) from public.order_items i where i.order_id = o.id),
          'returns', (select coalesce(jsonb_agg(jsonb_build_object('return_number', r.return_number, 'status', r.status, 'reason', r.reason, 'created_at', r.created_at, 'refund_cents', r.refund_cents) order by r.created_at), '[]'::jsonb) from public.returns r where r.order_id = o.id)
        ) order by o.created_at desc)
      from public.orders o
      where (v_user.id is not null and o.user_id = v_user.id) or (o.user_id is null and lower(o.email) = v_key)
    ), '[]'::jsonb)
  ) into v_result;

  if v_user.id is null and jsonb_array_length(v_result -> 'orders') = 0 then
    return null;
  end if;
  return v_result;
end;
$$;

revoke all on function public.admin_customer(text) from public;
grant execute on function public.admin_customer(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Stock: set a new number only if nobody bought one in the meantime.
-- Returns { ok, stock } — stock is the current number either way.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_stock(p_variant_id uuid, p_expected int, p_stock int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current int;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_stock is null or p_stock < 0 or p_stock > 100000 then
    raise exception using errcode = 'P0001', message = 'invalid_stock';
  end if;

  update public.product_variants set stock = p_stock
  where id = p_variant_id and stock = p_expected
  returning stock into v_current;
  if found then
    return jsonb_build_object('ok', true, 'stock', v_current);
  end if;

  select stock into v_current from public.product_variants where id = p_variant_id;
  return jsonb_build_object('ok', false, 'stock', v_current);
end;
$$;

revoke all on function public.admin_set_stock(uuid, int, int) from public;
grant execute on function public.admin_set_stock(uuid, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Save a product (new or existing) and keep its variants in step with its
-- colours and sizes. Renamed colours/sizes keep their stock; removed ones are
-- deleted; new combinations start at 0.
--
-- p: { id?, name, slug?, category_slug, short_description, description,
--      materials, care[], details[], price_cents, images[], is_featured,
--      is_new, is_published,
--      colours: [{ name, hex, previous_name? }],
--      sizes:   [{ label, previous_label?, price_cents? }] }
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_product(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := trim(coalesce(p ->> 'name', ''));
  v_slug text;
  v_base text;
  v_n int := 1;
  v_colours jsonb := coalesce(p -> 'colours', '[]'::jsonb);
  v_sizes jsonb := coalesce(p -> 'sizes', '[]'::jsonb);
  v_price int := (p ->> 'price_cents')::int;
  v_row record;
  v_i int := 0;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  -- Validation
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;
  if not exists (select 1 from public.categories where slug = p ->> 'category_slug') then
    raise exception using errcode = 'P0001', message = 'invalid_category';
  end if;
  if v_price is null or v_price <= 0 or v_price > 1000000 then
    raise exception using errcode = 'P0001', message = 'invalid_price';
  end if;
  if jsonb_array_length(v_colours) = 0 or jsonb_array_length(v_sizes) = 0 then
    raise exception using errcode = 'P0001', message = 'need_colour_and_size';
  end if;
  if exists (select 1 from jsonb_array_elements(v_colours) c
             where trim(coalesce(c ->> 'name', '')) = '' or coalesce(c ->> 'hex', '') !~ '^#[0-9a-fA-F]{6}$')
     or (select count(distinct lower(trim(c ->> 'name'))) from jsonb_array_elements(v_colours) c) <> jsonb_array_length(v_colours) then
    raise exception using errcode = 'P0001', message = 'invalid_colours';
  end if;
  if exists (select 1 from jsonb_array_elements(v_sizes) s
             where trim(coalesce(s ->> 'label', '')) = ''
                or (s ? 'price_cents' and s ->> 'price_cents' is not null and (s ->> 'price_cents')::int <= 0))
     or (select count(distinct lower(trim(s ->> 'label'))) from jsonb_array_elements(v_sizes) s) <> jsonb_array_length(v_sizes) then
    raise exception using errcode = 'P0001', message = 'invalid_sizes';
  end if;

  -- Insert or update the product itself
  if v_id is null then
    v_base := coalesce(nullif(p ->> 'slug', ''), 'product');
    if v_base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception using errcode = 'P0001', message = 'invalid_slug';
    end if;
    v_slug := v_base;
    while exists (select 1 from public.products where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n;
    end loop;

    insert into public.products (slug, category_slug, name, price_cents, sort_order)
    values (v_slug, p ->> 'category_slug', v_name, v_price,
            coalesce((select max(sort_order) + 1 from public.products where category_slug = p ->> 'category_slug'), 1))
    returning id into v_id;
  elsif not exists (select 1 from public.products where id = v_id) then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  update public.products set
    name = v_name,
    category_slug = p ->> 'category_slug',
    short_description = trim(coalesce(p ->> 'short_description', '')),
    description = trim(coalesce(p ->> 'description', '')),
    materials = trim(coalesce(p ->> 'materials', '')),
    care = coalesce(array(select trim(x) from jsonb_array_elements_text(p -> 'care') x where trim(x) <> ''), '{}'),
    details = coalesce(array(select trim(x) from jsonb_array_elements_text(p -> 'details') x where trim(x) <> ''), '{}'),
    price_cents = v_price,
    images = coalesce(array(select x from jsonb_array_elements_text(p -> 'images') x), '{}'),
    colours = (select jsonb_agg(jsonb_build_object('name', trim(c ->> 'name'), 'hex', lower(c ->> 'hex')) order by ord)
               from jsonb_array_elements(v_colours) with ordinality t(c, ord)),
    sizes = array(select trim(s ->> 'label') from jsonb_array_elements(v_sizes) with ordinality t(s, ord) order by ord),
    is_featured = coalesce((p ->> 'is_featured')::boolean, false),
    is_new = coalesce((p ->> 'is_new')::boolean, false),
    is_published = coalesce((p ->> 'is_published')::boolean, false)
  where id = v_id;

  -- First drop combinations whose colour or size is gone (judged by where each
  -- entry came from, so a renamed colour isn't mistaken for a removed one).
  delete from public.product_variants v
  where v.product_id = v_id
    and (v.colour not in (select trim(coalesce(nullif(c ->> 'previous_name', ''), c ->> 'name')) from jsonb_array_elements(v_colours) c)
      or v.size not in (select trim(coalesce(nullif(s ->> 'previous_label', ''), s ->> 'label')) from jsonb_array_elements(v_sizes) s));

  -- Renames, in two steps so swapping two names can't collide.
  for v_row in
    select trim(c ->> 'previous_name') as old, trim(c ->> 'name') as new
    from jsonb_array_elements(v_colours) c
    where coalesce(c ->> 'previous_name', '') <> '' and trim(c ->> 'previous_name') <> trim(c ->> 'name')
  loop
    v_i := v_i + 1;
    update public.product_variants set colour = '__rename_' || v_i || '__' || v_row.new
    where product_id = v_id and colour = v_row.old;
  end loop;
  update public.product_variants set colour = regexp_replace(colour, '^__rename_\d+__', '')
  where product_id = v_id and colour like '\_\_rename\_%';

  v_i := 0;
  for v_row in
    select trim(s ->> 'previous_label') as old, trim(s ->> 'label') as new
    from jsonb_array_elements(v_sizes) s
    where coalesce(s ->> 'previous_label', '') <> '' and trim(s ->> 'previous_label') <> trim(s ->> 'label')
  loop
    v_i := v_i + 1;
    update public.product_variants set size = '__rename_' || v_i || '__' || v_row.new
    where product_id = v_id and size = v_row.old;
  end loop;
  update public.product_variants set size = regexp_replace(size, '^__rename_\d+__', '')
  where product_id = v_id and size like '\_\_rename\_%';

  -- New combinations start at 0.
  insert into public.product_variants (product_id, colour, size, stock)
  select v_id, trim(c ->> 'name'), trim(s ->> 'label'), 0
  from jsonb_array_elements(v_colours) c cross join jsonb_array_elements(v_sizes) s
  on conflict (product_id, colour, size) do nothing;

  -- Size-specific prices (e.g. a larger blanket)
  update public.product_variants v
  set price_cents = nullif(s ->> 'price_cents', '')::int
  from jsonb_array_elements(v_sizes) s
  where v.product_id = v_id and v.size = trim(s ->> 'label');

  return jsonb_build_object('id', v_id, 'slug', (select slug from public.products where id = v_id));
end;
$$;

revoke all on function public.admin_save_product(jsonb) from public;
grant execute on function public.admin_save_product(jsonb) to authenticated;
