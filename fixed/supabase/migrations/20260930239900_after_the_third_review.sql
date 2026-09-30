-- Fourth round: what the independent review of the third fix found.

-- ---------------------------------------------------------------------------
-- The order's page data: only what the page shows
-- ---------------------------------------------------------------------------
-- Also without the account id, the discount code's id and Stripe's payment id.
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

  return (to_jsonb(v_order) - 'access_token' - 'client_key' - 'attempt_key' - 'user_id' - 'discount_code_id' - 'stripe_payment_intent') || jsonb_build_object(
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
-- A return can be closed with no refund again
-- ---------------------------------------------------------------------------
-- The third fix refused a refund of nothing while money was left on the order;
-- that left no way to close a return whose parcel never came back, or one the
-- owner decides not to refund. A zero is allowed again; the email says the
-- return was closed without a refund (or that the money had gone back already).
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
