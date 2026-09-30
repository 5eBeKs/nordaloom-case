-- Emails: every message the shop would send is written to an outbox, with a
-- snapshot of the details it needs. Templates (src/emails) turn a row into the
-- actual email. Until an email service is connected nothing is delivered;
-- a sender can later pick up rows with status 'queued'.

alter table public.shop_settings
  add column site_url text not null default 'http://localhost:3300',
  add column welcome_discount_code text default 'WELCOME10',
  add column contact_email text not null default 'owner@nordaloom.example';

-- The newsletter welcome code the owner asked for.
insert into public.discount_codes (code, kind, value, first_order_only, note)
values ('WELCOME10', 'percent', 10, true, 'Newsletter welcome')
on conflict (code) do nothing;

create table public.emails (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'order_confirmation', 'payment_reminder', 'payment_received', 'order_shipped', 'order_delivered',
    'return_approved', 'return_refused', 'refund_sent', 'newsletter_welcome')),
  to_email text not null,
  to_name text,
  order_id uuid references public.orders (id) on delete cascade,
  return_id uuid references public.returns (id) on delete cascade,
  -- Everything the template needs, as it was at that moment.
  data jsonb not null,
  -- 'queued' = waiting for an email service; 'sent' / 'failed' once one exists.
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  -- One email of each kind per order / return / subscriber.
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);

create index emails_created_idx on public.emails (created_at desc);
create index emails_order_idx on public.emails (order_id);

alter table public.emails enable row level security;
create policy "Owner reads emails" on public.emails
  for select to authenticated using (public.is_owner());

-- ---------------------------------------------------------------------------
-- Snapshot of an order for email templates.
-- ---------------------------------------------------------------------------
create or replace function public.order_email_data(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (to_jsonb(o) - 'user_id') || jsonb_build_object(
    'first_name', split_part(trim(o.full_name), ' ', 1),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.product_name, 'slug', i.product_slug, 'image', i.product_image,
        'colour', i.colour, 'size', i.size, 'quantity', i.quantity,
        'unit_price_cents', i.unit_price_cents, 'line_total_cents', i.line_total_cents) order by i.product_name)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'bank', (select jsonb_build_object('recipient', s.bank_recipient, 'iban', s.bank_iban, 'bic', s.bank_bic, 'bank_name', s.bank_name) from public.shop_settings s limit 1),
    'site_url', (select site_url from public.shop_settings limit 1),
    'contact_email', (select contact_email from public.shop_settings limit 1),
    'return_days', (select return_days from public.shop_settings limit 1),
    'return_until', case when o.delivered_at is not null
      then o.delivered_at + make_interval(days => (select return_days from public.shop_settings limit 1)) end,
    'is_account_order', o.user_id is not null
  )
  from public.orders o where o.id = p_order_id;
$$;

revoke all on function public.order_email_data(uuid) from public, anon, authenticated;

create or replace function public.queue_order_email(p_order_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb := public.order_email_data(p_order_id);
begin
  if v_data is null then return; end if;
  insert into public.emails (kind, to_email, to_name, order_id, data, dedupe_key)
  values (p_kind, v_data ->> 'email', v_data ->> 'full_name', p_order_id, v_data, p_kind || ':' || p_order_id)
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke all on function public.queue_order_email(uuid, text) from public, anon, authenticated;

-- Order confirmation: at the end of the transaction, once the items exist.
create or replace function public.email_on_order_placed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.queue_order_email(new.id, 'order_confirmation');
  return null;
end;
$$;

create constraint trigger orders_email_placed
  after insert on public.orders
  deferrable initially deferred
  for each row execute function public.email_on_order_placed();

-- Paid, shipped, delivered.
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
  end if;
  return null;
end;
$$;

create trigger orders_email_status
  after update of status on public.orders
  for each row execute function public.email_on_order_status();

-- Payment reminder two days before the deadline (checked every 15 minutes).
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

revoke all on function public.queue_payment_reminders() from public, anon, authenticated;
select cron.schedule('payment-reminders', '*/15 * * * *', 'select public.queue_payment_reminders()');

-- Returns: approved, refused, refunded.
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
      'shop_note', new.shop_note, 'refund_cents', new.refund_cents, 'created_at', new.created_at,
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

create trigger returns_email_status
  after update of status on public.returns
  for each row execute function public.email_on_return_status();

-- Newsletter welcome, with the welcome code if it's live.
create or replace function public.email_on_newsletter_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.shop_settings;
  v_code public.discount_codes;
begin
  select * into v_settings from public.shop_settings limit 1;
  select * into v_code from public.discount_codes d
  where d.code = v_settings.welcome_discount_code and d.is_active and (d.ends_at is null or d.ends_at > now());

  insert into public.emails (kind, to_email, data, dedupe_key)
  values ('newsletter_welcome', new.email, jsonb_build_object(
    'email', new.email,
    'site_url', v_settings.site_url,
    'contact_email', v_settings.contact_email,
    'code', case when v_code.id is not null then jsonb_build_object(
      'code', v_code.code, 'kind', v_code.kind, 'value', v_code.value,
      'first_order_only', v_code.first_order_only, 'min_order_cents', v_code.min_order_cents, 'ends_at', v_code.ends_at) end
  ), 'newsletter_welcome:' || new.id)
  on conflict (dedupe_key) do nothing;
  return null;
end;
$$;

create trigger newsletter_email_welcome
  after insert on public.newsletter_subscribers
  for each row execute function public.email_on_newsletter_signup();
