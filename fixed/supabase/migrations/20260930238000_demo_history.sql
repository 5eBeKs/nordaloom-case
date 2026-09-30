-- A made-up trading history (see scripts/demo-history.mjs), so the shop and
-- the admin can be seen as they'll look after months of trading.
--
-- Everything it adds is recorded here, so it can all be removed in one go
-- (select public.remove_demo_history()), with the stock put back exactly as
-- it was. Made-up customers use addresses at reserved ".example" domains,
-- which can never receive mail, and the shop never even queues an email to
-- them.

create table public.demo_people (
  email text primary key -- lower-case
);

-- How much the history changed each variant's stock (e.g. -7 = seven fewer on
-- the shelf because of made-up sales, holds, restocks and returns). Taken back
-- off when the history is removed, so real changes made since are kept.
create table public.demo_stock_change (
  variant_id uuid primary key references public.product_variants (id) on delete cascade,
  change int not null
);

-- When the history was loaded (things demo orders do after that — cancelling
-- themselves, returns put back in stock — are undone on removal too).
create table public.demo_meta (
  id boolean primary key default true check (id),
  loaded_at timestamptz not null
);

-- Discount codes that exist only in the history.
create table public.demo_codes (
  code text primary key
);

alter table public.demo_people enable row level security;
alter table public.demo_stock_change enable row level security;
alter table public.demo_codes enable row level security;
alter table public.demo_meta enable row level security;
-- No policies: nobody reaches these through the API.

-- No email, ever, to a made-up customer (e.g. when the owner ships a demo order).
create or replace function public.emails_skip_demo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.demo_people where email = lower(new.to_email)) then
    return null;
  end if;
  return new;
end;
$$;

create trigger emails_skip_demo
  before insert on public.emails
  for each row execute function public.emails_skip_demo();

-- Takes the whole history out again. Real customers, orders and settings are
-- untouched; stock goes back to what it was before the history was loaded
-- (plus or minus anything real that has happened since).
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
  delete from public.discount_codes where code in (select code from public.demo_codes);
  get diagnostics v_codes = row_count;

  truncate public.demo_people, public.demo_stock_change, public.demo_codes, public.demo_meta;
  return jsonb_build_object('orders', v_orders, 'accounts', v_users, 'newsletter', v_subs,
                            'messages', v_msgs, 'codes', v_codes, 'variants_restocked', v_stock);
end;
$$;

revoke all on function public.remove_demo_history() from public, anon, authenticated;
revoke all on function public.emails_skip_demo() from public, anon, authenticated;
