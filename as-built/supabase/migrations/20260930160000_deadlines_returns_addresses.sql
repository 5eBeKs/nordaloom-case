-- Bank details, a payment deadline with automatic cancellation, a "delivered"
-- step, returns, and saved addresses.

-- ---------------------------------------------------------------------------
-- Settings: bank details, payment and return windows
-- ---------------------------------------------------------------------------
alter table public.shop_settings
  add column payment_days int not null default 5 check (payment_days between 1 and 60),
  add column return_days int not null default 14 check (return_days between 1 and 365);

update public.shop_settings
set bank_recipient = 'Nordaloom SIA',
    bank_name = 'Example Bank',
    bank_iban = 'LV00 EXMP 0000 0000 0000 0',
    bank_bic = 'EXMPLV22',
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Orders: delivered status, payment deadline, why an order was cancelled
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('awaiting_payment', 'paid', 'shipped', 'delivered', 'cancelled'));

alter table public.orders
  add column payment_due_at timestamptz,
  add column delivered_at timestamptz,
  add column cancel_reason text check (cancel_reason in ('not_paid', 'by_shop'));

update public.orders
set payment_due_at = created_at + make_interval(days => (select payment_days from public.shop_settings limit 1))
where payment_due_at is null;

create or replace function public.set_payment_due()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.payment_due_at := coalesce(
    new.payment_due_at,
    now() + make_interval(days => (select payment_days from public.shop_settings limit 1))
  );
  return new;
end;
$$;

create trigger orders_set_payment_due
  before insert on public.orders
  for each row execute function public.set_payment_due();

create index orders_payment_due_idx on public.orders (payment_due_at) where status = 'awaiting_payment';

-- Cancels unpaid orders past their deadline and puts their pieces back.
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

revoke all on function public.cancel_overdue_orders() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('cancel-overdue-orders', '*/5 * * * *', 'select public.cancel_overdue_orders()');

-- Owner status changes, now including "delivered".
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

-- get_order also reports the return window.
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
    ),
    'return_until', case when v_order.delivered_at is not null
      then v_order.delivered_at + make_interval(days => v_settings.return_days) end,
    'is_account_order', v_order.user_id is not null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Returns
-- ---------------------------------------------------------------------------
create sequence public.return_number_seq start 1001;

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  return_number text not null unique default ('RET-' || nextval('public.return_number_seq')),
  order_id uuid not null references public.orders (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'refused', 'refunded')),
  reason text not null
    check (reason in ('too_small', 'too_big', 'not_as_expected', 'faulty', 'changed_mind', 'other')),
  details text not null default '' check (length(details) <= 1000),
  -- Message from the shop to the customer (instructions, or why it was refused)
  shop_note text not null default '' check (length(shop_note) <= 1000),
  refund_cents int check (refund_cents >= 0),
  restocked boolean not null default false,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  refunded_at timestamptz
);

create index returns_order_idx on public.returns (order_id);
create index returns_status_idx on public.returns (status, created_at desc);

create table public.return_items (
  return_id uuid not null references public.returns (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  quantity int not null check (quantity > 0),
  primary key (return_id, order_item_id)
);

alter table public.returns enable row level security;
alter table public.return_items enable row level security;

create policy "Customers read own returns" on public.returns
  for select to authenticated using (user_id = auth.uid() or public.is_owner());
create policy "Customers read own return items" on public.return_items
  for select to authenticated using (
    exists (select 1 from public.returns r where r.id = return_id and (r.user_id = auth.uid() or public.is_owner()))
  );

-- A customer asks to return pieces from one of their delivered orders.
-- p_items: [{ "order_item_id": uuid, "quantity": int }, ...]
create or replace function public.request_return(
  p_order_number text,
  p_items jsonb,
  p_reason text,
  p_details text default ''
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_settings public.shop_settings;
  v_return public.returns;
  v_line record;
  v_details text := trim(coalesce(p_details, ''));
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not_signed_in';
  end if;

  select * into v_order from public.orders
  where order_number = p_order_number and user_id = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  select * into v_settings from public.shop_settings limit 1;
  if v_order.status <> 'delivered' or v_order.delivered_at is null then
    raise exception using errcode = 'P0001', message = 'not_delivered';
  end if;
  if now() > v_order.delivered_at + make_interval(days => v_settings.return_days) then
    raise exception using errcode = 'P0001', message = 'window_closed';
  end if;

  if p_reason not in ('too_small', 'too_big', 'not_as_expected', 'faulty', 'changed_mind', 'other') then
    raise exception using errcode = 'P0001', message = 'invalid_reason';
  end if;
  if p_reason = 'other' and v_details = '' then
    raise exception using errcode = 'P0001', message = 'details_required';
  end if;
  if length(v_details) > 1000 then
    raise exception using errcode = 'P0001', message = 'details_too_long';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'no_items';
  end if;

  -- Each piece must belong to the order and not already be in another
  -- (not refused) return.
  for v_line in
    select (e ->> 'order_item_id')::uuid as order_item_id, sum((e ->> 'quantity')::int)::int as quantity
    from jsonb_array_elements(p_items) e
    group by 1
  loop
    if v_line.quantity is null or v_line.quantity < 1 or v_line.quantity > (
      select i.quantity - coalesce((
        select sum(ri.quantity) from public.return_items ri
        join public.returns r on r.id = ri.return_id
        where ri.order_item_id = i.id and r.status <> 'refused'
      ), 0)
      from public.order_items i
      where i.id = v_line.order_item_id and i.order_id = v_order.id
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_items';
    end if;
  end loop;

  insert into public.returns (order_id, user_id, reason, details)
  values (v_order.id, auth.uid(), p_reason, v_details)
  returning * into v_return;

  insert into public.return_items (return_id, order_item_id, quantity)
  select v_return.id, (e ->> 'order_item_id')::uuid, sum((e ->> 'quantity')::int)
  from jsonb_array_elements(p_items) e
  group by 2;

  return v_return.return_number;
end;
$$;

revoke all on function public.request_return(text, jsonb, text, text) from public;
grant execute on function public.request_return(text, jsonb, text, text) to authenticated;

-- The owner approves or refuses a request, then marks it refunded when the
-- pieces are back (optionally putting them back in stock).
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
    update public.returns
    set status = 'refunded', refund_cents = p_refund_cents, restocked = p_restock, refunded_at = now()
    where id = p_return_id returning * into v_return;
  else
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  return v_return;
end;
$$;

revoke all on function public.update_return(uuid, text, text, int, boolean) from public;
grant execute on function public.update_return(uuid, text, text, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Saved addresses (up to 5 per customer, one default)
-- ---------------------------------------------------------------------------
create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null default '' check (length(label) <= 40),
  full_name text not null check (length(full_name) between 2 and 200),
  phone text not null check (length(phone) between 6 and 40),
  country text not null check (length(country) = 2),
  address_line1 text not null check (length(address_line1) between 1 and 200),
  address_line2 text not null default '' check (length(address_line2) <= 200),
  city text not null check (length(city) between 1 and 100),
  postal_code text not null check (length(postal_code) between 1 and 20),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index customer_addresses_user_idx on public.customer_addresses (user_id);
create unique index customer_addresses_one_default on public.customer_addresses (user_id) where is_default;

alter table public.customer_addresses enable row level security;
create policy "Customers manage own addresses" on public.customer_addresses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.customer_addresses_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.customer_addresses where user_id = new.user_id) >= 5 then
      raise exception using errcode = 'P0001', message = 'address_limit';
    end if;
    -- The first address becomes the default.
    if not exists (select 1 from public.customer_addresses where user_id = new.user_id) then
      new.is_default := true;
    end if;
  end if;
  -- Only one default: clear it on the others first.
  if new.is_default then
    update public.customer_addresses
    set is_default = false
    where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end;
$$;

create trigger customer_addresses_before_write
  before insert or update on public.customer_addresses
  for each row execute function public.customer_addresses_before_write();
