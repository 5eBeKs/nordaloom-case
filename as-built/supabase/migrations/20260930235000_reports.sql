-- Reports for the owner: one function that works out every section of the
-- reports page for a chosen period (and the period of the same length just
-- before it).
--
-- Definitions (the same as the dashboard's):
--   a sale     = an order that was paid and not cancelled (paid, shipped or delivered),
--                dated by the day it was placed, in Latvian time;
--   revenue    = what customers paid: pieces after discounts, plus delivery, VAT included;
--   refunds    = money given back for returns, dated by the day it was refunded;
--   a customer = an email address.

create or replace function public.admin_report(p_from date, p_to date, p_group text default 'day')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_len int := p_to - p_from + 1;
  v_prev_from date := p_from - (p_to - p_from + 1);
  v_prev_to date := p_from - 1;
  v_unit text := case when p_group in ('day', 'week', 'month') then p_group else 'day' end;
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or v_len > 3700 then
    raise exception using errcode = 'P0001', message = 'invalid_period';
  end if;

  -- Every order with its Latvian day, and whether it counts as a sale.
  create temporary table _o on commit drop as
    select o.*,
           (o.created_at at time zone 'Europe/Riga')::date as day,
           lower(o.email) as customer,
           o.status in ('paid', 'shipped', 'delivered') as sold
    from public.orders o;

  -- Each customer's first sale ever.
  create temporary table _first on commit drop as
    select customer, min(created_at) as first_at, count(*) as orders
    from _o where sold group by customer;

  create temporary table _cur on commit drop as select * from _o where sold and day between p_from and p_to;
  create temporary table _prev on commit drop as select * from _o where sold and day between v_prev_from and v_prev_to;

  -- Pieces sold in the period, with product, category and what came back.
  create temporary table _lines on commit drop as
    select i.id, i.order_id, i.product_id, i.product_slug, i.product_name, i.colour, i.size, i.quantity, i.line_total_cents,
           coalesce(p.category_slug, '') as category_slug, coalesce(c.name, 'No longer in the shop') as category_name,
           coalesce((select sum(ri.quantity) from public.return_items ri join public.returns r on r.id = ri.return_id
                     where ri.order_item_id = i.id and r.status <> 'refused'), 0)::int as returned
    from public.order_items i
    join _cur o on o.id = i.order_id
    left join public.products p on p.id = i.product_id
    left join public.categories c on c.slug = p.category_slug;

  create temporary table _prev_lines on commit drop as
    select i.product_id, i.product_slug, coalesce(p.category_slug, '') as category_slug, i.quantity, i.line_total_cents
    from public.order_items i
    join _prev o on o.id = i.order_id
    left join public.products p on p.id = i.product_id;

  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_len, 'group', v_unit,
                                 'previous_from', v_prev_from, 'previous_to', v_prev_to),

    -- ---------------------------------------------------------------- summary
    'summary', (
      select jsonb_build_object(
        'current', public.report_summary(p_from, p_to),
        'previous', public.report_summary(v_prev_from, v_prev_to)
      )
    ),

    -- ------------------------------------------------ sales by day/week/month
    -- The previous period is shifted forward by the period's length, so each
    -- bucket lines up with the matching bucket before it.
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'start', b.start::date,
        'orders', coalesce(c.n, 0), 'revenue_cents', coalesce(c.revenue, 0),
        'previous_orders', coalesce(pv.n, 0), 'previous_revenue_cents', coalesce(pv.revenue, 0)
      ) order by b.start), '[]'::jsonb)
      from generate_series(date_trunc(v_unit, p_from::timestamp), date_trunc(v_unit, p_to::timestamp), ('1 ' || v_unit)::interval) b(start)
      left join (
        select date_trunc(v_unit, day::timestamp) k, count(*) n, sum(total_cents) revenue from _cur group by 1
      ) c on c.k = b.start
      left join (
        select date_trunc(v_unit, (day + v_len)::timestamp) k, count(*) n, sum(total_cents) revenue from _prev group by 1
      ) pv on pv.k = b.start
    ),

    -- ------------------------------------------------------------ categories
    'categories', (
      select coalesce(jsonb_agg(x order by x.revenue_cents desc), '[]'::jsonb) from (
        select l.category_name as category,
               sum(l.quantity)::int as units,
               sum(l.line_total_cents)::int as revenue_cents,
               coalesce((select sum(pl.line_total_cents) from _prev_lines pl where pl.category_slug = l.category_slug), 0)::int as previous_revenue_cents,
               sum(l.returned)::int as returned_units
        from _lines l group by l.category_slug, l.category_name
      ) x
    ),

    -- -------------------------------------------------------------- products
    'products', (
      select coalesce(jsonb_agg(x order by x.revenue_cents desc, x.units desc), '[]'::jsonb) from (
        select coalesce(max(p.name), max(l.product_name)) as product, max(l.category_name) as category,
               sum(l.quantity)::int as units, sum(l.line_total_cents)::int as revenue_cents,
               sum(l.returned)::int as returned_units,
               coalesce((select sum(pl.quantity) from _prev_lines pl where pl.product_slug = l.product_slug), 0)::int as previous_units,
               (select sum(v.stock) from public.product_variants v join public.products pp on pp.id = v.product_id where pp.slug = l.product_slug)::int as stock
        from _lines l left join public.products p on p.id = l.product_id
        group by l.product_slug
      ) x
    ),

    -- ------------------------------------------------------ sizes and colours
    'sizes', (
      select coalesce(jsonb_agg(x order by x.units desc), '[]'::jsonb) from (
        select size, coalesce(sold.units, 0) as units, coalesce(sold.revenue_cents, 0) as revenue_cents,
               coalesce(sold.returned_units, 0) as returned_units, coalesce(s.stock, 0) as stock
        from (
          select v.size, sum(v.stock)::int as stock
          from public.product_variants v join public.products p on p.id = v.product_id
          where p.is_published group by v.size
        ) s
        full join (
          select size, sum(quantity)::int as units, sum(line_total_cents)::int as revenue_cents, sum(returned)::int as returned_units
          from _lines group by size
        ) sold using (size)
      ) x
    ),
    'colours', (
      select coalesce(jsonb_agg(x order by x.units desc), '[]'::jsonb) from (
        select colour, coalesce(sold.units, 0) as units, coalesce(sold.revenue_cents, 0) as revenue_cents, coalesce(s.stock, 0) as stock
        from (
          select v.colour, sum(v.stock)::int as stock
          from public.product_variants v join public.products p on p.id = v.product_id
          where p.is_published group by v.colour
        ) s
        full join (
          select colour, sum(quantity)::int as units, sum(line_total_cents)::int as revenue_cents
          from _lines group by colour
        ) sold using (colour)
      ) x
    ),
    -- In stock, in the shop, and not one sold in the period.
    'sitting', (
      select coalesce(jsonb_agg(x order by x.stock desc, x.product), '[]'::jsonb) from (
        select p.name as product, c.name as category, v.colour, v.size, v.stock,
               (select max(o.day) from _o o join public.order_items i on i.order_id = o.id
                where o.sold and i.variant_id = v.id) as last_sold
        from public.product_variants v
        join public.products p on p.id = v.product_id
        left join public.categories c on c.slug = p.category_slug
        where p.is_published and v.stock > 0
          and not exists (
            select 1 from public.order_items i join _cur o on o.id = i.order_id where i.variant_id = v.id)
      ) x
    ),

    -- ------------------------------------------------------------- customers
    'customers', (
      select jsonb_build_object(
        'new', (select count(distinct o.customer) from _cur o join _first f using (customer) where f.first_at >= p_from::timestamp at time zone 'Europe/Riga'),
        'returning', (select count(distinct o.customer) from _cur o join _first f using (customer) where f.first_at < p_from::timestamp at time zone 'Europe/Riga'),
        'new_orders', (select count(*) from _cur o join _first f using (customer) where f.first_at >= p_from::timestamp at time zone 'Europe/Riga'),
        'returning_orders', (select count(*) from _cur o join _first f using (customer) where f.first_at < p_from::timestamp at time zone 'Europe/Riga'),
        'new_revenue_cents', (select coalesce(sum(o.total_cents), 0) from _cur o join _first f using (customer) where f.first_at >= p_from::timestamp at time zone 'Europe/Riga'),
        'returning_revenue_cents', (select coalesce(sum(o.total_cents), 0) from _cur o join _first f using (customer) where f.first_at < p_from::timestamp at time zone 'Europe/Riga'),
        -- Of the people whose first order was in this period, how many have ordered again since.
        'first_timers', (select count(*) from _first f where (f.first_at at time zone 'Europe/Riga')::date between p_from and p_to),
        'first_timers_came_back', (select count(*) from _first f where (f.first_at at time zone 'Europe/Riga')::date between p_from and p_to and f.orders >= 2),
        -- Everyone who has ever ordered (up to the end of the period).
        'all_customers', (select count(distinct customer) from _o where sold and day <= p_to),
        'all_repeat_customers', (select count(*) from (select customer from _o where sold and day <= p_to group by customer having count(*) >= 2) r),
        'median_days_to_second_order', (
          select percentile_cont(0.5) within group (order by gap)
          from (
            select extract(epoch from (second_at - first_at)) / 86400 as gap from (
              select customer,
                     min(created_at) as first_at,
                     (array_agg(created_at order by created_at))[2] as second_at
              from _o where sold and day <= p_to group by customer
            ) t where second_at is not null
          ) g
        )
      )
    ),

    -- --------------------------------------------------------------- returns
    'returns', (
      select jsonb_build_object(
        'orders', (select count(*) from _cur),
        'orders_with_returns', (select count(*) from _cur o where exists (select 1 from public.returns r where r.order_id = o.id and r.status <> 'refused')),
        'pieces_sold', (select coalesce(sum(quantity), 0) from _lines),
        'pieces_returned', (select coalesce(sum(returned), 0) from _lines),
        'refunded_cents', (
          select coalesce(sum(r.refund_cents), 0) from public.returns r
          where r.status = 'refunded' and (r.refunded_at at time zone 'Europe/Riga')::date between p_from and p_to),
        'reasons', (
          select coalesce(jsonb_agg(x order by x.returns desc), '[]'::jsonb) from (
            select r.reason, count(*)::int as returns, sum((select sum(quantity) from public.return_items ri where ri.return_id = r.id))::int as pieces,
                   count(*) filter (where r.status = 'refused')::int as refused
            from public.returns r join _cur o on o.id = r.order_id
            group by r.reason
          ) x
        )
      )
    ),

    -- -------------------------------------------------------- discount codes
    'discounts', (
      select coalesce(jsonb_agg(x order by x.orders desc), '[]'::jsonb) from (
        select coalesce(o.discount_code, '') as code,
               count(*)::int as orders,
               sum(o.total_cents)::int as revenue_cents,
               sum(o.discount_cents)::int as discount_cents,
               round(avg(o.total_cents))::int as average_order_cents,
               count(*) filter (where o.created_at = f.first_at)::int as first_orders
        from _cur o join _first f using (customer)
        group by coalesce(o.discount_code, '')
      ) x
    ),

    -- --------------------------------------------- started but never paid
    'payments', (
      select coalesce(jsonb_agg(x order by x.method), '[]'::jsonb) from (
        select o.payment_method as method,
               count(*)::int as started,
               count(*) filter (where o.paid_at is not null)::int as paid,
               count(*) filter (where o.status = 'cancelled' and o.cancel_reason = 'not_paid')::int as never_paid,
               count(*) filter (where o.status = 'awaiting_payment')::int as waiting,
               count(*) filter (where o.status = 'cancelled' and o.cancel_reason = 'by_shop' and o.paid_at is null)::int as cancelled_by_shop,
               coalesce(sum(o.total_cents) filter (where o.status = 'cancelled' and o.cancel_reason = 'not_paid'), 0)::int as never_paid_cents
        from _o o where o.day between p_from and p_to
        group by o.payment_method
      ) x
    ),

    -- ------------------------------------------------------------- countries
    'countries', (
      select coalesce(jsonb_agg(x order by x.revenue_cents desc), '[]'::jsonb) from (
        select o.country, count(*)::int as orders, sum(o.total_cents)::int as revenue_cents,
               sum(o.shipping_cents)::int as shipping_cents, count(distinct o.customer)::int as customers,
               count(*) filter (where o.shipping_code = 'omniva_lv')::int as locker_orders
        from _cur o group by o.country
      ) x
    )
  ) into v_result;

  return v_result;
end;
$$;

-- The headline figures for one period.
create or replace function public.report_summary(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select o.* from public.orders o
    where o.status in ('paid', 'shipped', 'delivered')
      and (o.created_at at time zone 'Europe/Riga')::date between p_from and p_to
  )
  select jsonb_build_object(
    'orders', (select count(*) from s),
    'revenue_cents', (select coalesce(sum(total_cents), 0) from s),
    'pieces', (select coalesce(sum(i.quantity), 0) from public.order_items i join s on s.id = i.order_id),
    'discount_cents', (select coalesce(sum(discount_cents), 0) from s),
    'shipping_cents', (select coalesce(sum(shipping_cents), 0) from s),
    'vat_cents', (select coalesce(sum(vat_cents), 0) from s),
    'customers', (select count(distinct lower(email)) from s),
    'refunded_cents', (
      select coalesce(sum(r.refund_cents), 0) from public.returns r
      where r.status = 'refunded' and (r.refunded_at at time zone 'Europe/Riga')::date between p_from and p_to)
  );
$$;

revoke all on function public.report_summary(date, date) from public, anon, authenticated;
revoke all on function public.admin_report(date, date, text) from public, anon;
grant execute on function public.admin_report(date, date, text) to authenticated;
