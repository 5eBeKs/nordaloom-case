-- Third round: what the independent review of the second fix found. The first
-- item was in the shop from the start; the rest came with, or were left open
-- by, the fixes.

-- ---------------------------------------------------------------------------
-- Who may open an order
-- ---------------------------------------------------------------------------
-- An order opens for the holder of its link, for the account that placed it,
-- and for the owner. The old test was written as "refuse unless one of these
-- is true", and for an order placed without an account the middle one is not
-- false but unknown (the order has no account to compare with). "Unless
-- unknown" did not refuse: any signed-in account could open any guest order by
-- its number, with name, email, phone and address. Each test is now either
-- true or it isn't.
--
-- The page's data also no longer carries the keys that make or find orders
-- (client_key, attempt_key): with them and the order's details, the same order
-- could be "sent again" to get its link.
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
  v_allowed boolean;
begin
  select * into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    return null;
  end if;
  v_allowed :=
    coalesce(p_token is not null and v_order.access_token = p_token, false)
    or coalesce(auth.uid() is not null and v_order.user_id is not null and v_order.user_id = auth.uid(), false)
    or coalesce(public.is_owner(), false);
  if v_allowed is not true then
    return null;
  end if;

  select * into v_settings from public.shop_settings limit 1;

  return (to_jsonb(v_order) - 'access_token' - 'client_key' - 'attempt_key') || jsonb_build_object(
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

-- The snapshot kept with each email: without those keys either, and the
-- snapshots already kept lose them (and the address fingerprint of the first fix).
create or replace function public.order_email_data(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (to_jsonb(o) - 'user_id' - 'client_key' - 'attempt_key') || jsonb_build_object(
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

update public.emails set data = data - 'placed_from' - 'client_key' - 'attempt_key'
where data ?| array['placed_from', 'client_key', 'attempt_key'];

-- ---------------------------------------------------------------------------
-- Switching a card order to bank transfer: held to the same limit as ordering by bank transfer
-- ---------------------------------------------------------------------------
-- (Otherwise card orders, which the limit lets through, could be switched one
-- after another into any number of orders waiting for a transfer under one
-- email address, each with its email of bank details.)
-- Answers 'switched', 'not_switchable' or 'too_many_unpaid'.
drop function public.switch_to_bank_transfer(uuid);

create function public.switch_to_bank_transfer(p_order_id uuid)
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

-- ---------------------------------------------------------------------------
-- A card order cancelled with a payment page on record
-- ---------------------------------------------------------------------------
-- The two-minute check now also looks at card orders that were cancelled in the
-- last three days with a payment page on record and nothing returned: if the
-- page turns out to have been paid (the shop could not ask Stripe at the time),
-- the money goes back without waiting for the customer to open the order. Once
-- a page is known closed and unpaid it is taken off the record, so each such
-- order is asked about once.
select cron.schedule('sync-card-payments', '*/2 * * * *', $$
  select public.wake_card_sync()
  where exists (
    select 1 from public.orders
    where payment_method = 'card' and stripe_session_id is not null
      and (status = 'awaiting_payment'
           or (status = 'cancelled' and refunded_cents = 0 and cancelled_at > now() - interval '3 days'))
  )
$$);

-- A payment page that expired unpaid cancels its order: there is nothing more
-- to ask about it, so it goes off the record at once.
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
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'not_paid', stripe_session_id = null
  where id = p_order_id;
  return true;
end;
$$;

revoke all on function public.cancel_unpaid_card_order(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_unpaid_card_order(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- A return closed with nothing refunded
-- ---------------------------------------------------------------------------
-- Allowed only when nothing is left to refund on the order (the email then says
-- so, instead of "your refund of €0 is on its way"); with money left, a typed
-- zero is refused.
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
    -- A refund of nothing only closes a return when nothing is left to refund.
    if p_refund_cents = 0 and v_left > 0 then
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
