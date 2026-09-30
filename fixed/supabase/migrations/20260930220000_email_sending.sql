-- Emails are now really sent. The outbox stays as it was (triggers write a row
-- per email); the send-emails server function picks up queued rows, renders
-- them with the templates, sends them and records the result.
--
-- Only emails created after this migration are sent: everything already in
-- the outbox is marked 'skipped'.

create extension if not exists pg_net;

alter table public.emails drop constraint emails_status_check;
alter table public.emails add constraint emails_status_check
  check (status in ('queued', 'sending', 'sent', 'failed', 'skipped'));

alter table public.emails drop constraint emails_kind_check;
alter table public.emails add constraint emails_kind_check check (kind in (
  'order_confirmation', 'payment_reminder', 'order_cancelled', 'payment_received', 'order_shipped', 'order_delivered',
  'return_approved', 'return_refused', 'refund_sent', 'newsletter_welcome', 'password_reset'));

alter table public.emails
  add column attempts int not null default 0,
  add column next_attempt_at timestamptz,
  add column claimed_at timestamptz,
  -- The id the mail service gave the message.
  add column provider_id text;

create index emails_queue_idx on public.emails (created_at) where status in ('queued', 'failed', 'sending');

alter table public.shop_settings
  -- Emails created before this moment are never sent.
  add column email_sending_since timestamptz not null default now(),
  -- Where the database reaches the server functions (inside the local setup: the API gateway).
  add column functions_url text not null default 'http://kong:8000/functions/v1';

update public.emails
set status = 'skipped', error = 'Created before emails were switched on, so never sent.'
where status = 'queued';

-- ---------------------------------------------------------------------------
-- The sender's side (server function only; not callable from the shop)
-- ---------------------------------------------------------------------------

-- Hands out a batch of emails to send, so two senders never send the same one.
create or replace function public.claim_emails(p_limit int default 20)
returns setof public.emails
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := (select email_sending_since from public.shop_settings limit 1);
begin
  -- An email that waited more than two days without being sent is too late to be useful.
  update public.emails
  set status = 'skipped', error = 'Waited too long to be sent (over two days).'
  where status = 'queued' and created_at < now() - interval '2 days';
  update public.emails
  set status = 'skipped', error = 'Created before emails were switched on, so never sent.'
  where status = 'queued' and created_at < v_since;

  return query
  update public.emails e
  set status = 'sending', claimed_at = now(), attempts = e.attempts + 1
  where e.id in (
    select id from public.emails
    where created_at >= v_since
      and (
        (status = 'queued')
        or (status = 'failed' and attempts < 5 and next_attempt_at <= now())
        -- a sender that stopped half-way
        or (status = 'sending' and attempts < 5 and claimed_at < now() - interval '5 minutes')
      )
    order by created_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning e.*;
end;
$$;

revoke all on function public.claim_emails(int) from public, anon, authenticated;
grant execute on function public.claim_emails(int) to service_role;

create or replace function public.finish_email(p_id uuid, p_ok boolean, p_provider_id text default null, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.emails set
    status = case when p_ok then 'sent' else 'failed' end,
    sent_at = case when p_ok then now() else sent_at end,
    provider_id = coalesce(p_provider_id, provider_id),
    error = case when p_ok then null else left(p_error, 500) end,
    -- Try again after 1, 5, 15, 60 minutes.
    next_attempt_at = case when p_ok then null
      else now() + (array[1, 5, 15, 60, 60])[least(attempts, 5)] * interval '1 minute' end,
    claimed_at = null
  where id = p_id;
$$;

revoke all on function public.finish_email(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.finish_email(uuid, boolean, text, text) to service_role;

-- Password reset emails are sent straight away by their own function and only
-- logged here (without the link).
create or replace function public.log_email(p_kind text, p_to text, p_data jsonb, p_ok boolean, p_provider_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.emails (kind, to_email, data, status, sent_at, provider_id, error, attempts, dedupe_key)
  values (p_kind, p_to, p_data, case when p_ok then 'sent' else 'failed' end, case when p_ok then now() end,
          p_provider_id, left(p_error, 500), 1, p_kind || ':' || gen_random_uuid())
$$;

revoke all on function public.log_email(text, text, jsonb, boolean, text, text) from public, anon, authenticated;
grant execute on function public.log_email(text, text, jsonb, boolean, text, text) to service_role;

-- How many reset emails an address got in the last hour (to stop floods).
create or replace function public.recent_password_resets(p_email text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.emails
  where kind = 'password_reset' and lower(to_email) = lower(trim(p_email)) and created_at > now() - interval '1 hour';
$$;

revoke all on function public.recent_password_resets(text) from public, anon, authenticated;
grant execute on function public.recent_password_resets(text) to service_role;

-- ---------------------------------------------------------------------------
-- Waking the sender
-- ---------------------------------------------------------------------------

-- Asks the send-emails function to go through the queue. pg_net sends the
-- request after the transaction commits (and not at all if it rolls back).
create or replace function public.wake_email_sender()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := (select functions_url from public.shop_settings limit 1) || '/send-emails',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.wake_email_sender() from public, anon, authenticated;

create or replace function public.emails_wake_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from new_rows where status = 'queued') then
    perform public.wake_email_sender();
  end if;
  return null;
end;
$$;

create trigger emails_wake_sender
  after insert on public.emails
  referencing new table as new_rows
  for each statement execute function public.emails_wake_sender();

-- Every minute: retries, and anything that was queued while the sender was down.
select cron.schedule('send-emails', '* * * * *', $$
  select public.wake_email_sender()
  where exists (
    select 1 from public.emails
    where created_at >= (select email_sending_since from public.shop_settings limit 1)
      and (status = 'queued'
        or (status = 'failed' and attempts < 5 and next_attempt_at <= now())
        or (status = 'sending' and attempts < 5 and claimed_at < now() - interval '5 minutes'))
  )
$$);

-- ---------------------------------------------------------------------------
-- The owner: send a failed email again
-- ---------------------------------------------------------------------------
create or replace function public.retry_email(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  update public.emails
  set attempts = 0, next_attempt_at = now()
  where id = p_id and status = 'failed' and kind <> 'password_reset';
  if not found then raise exception 'not_retryable'; end if;
  perform public.wake_email_sender();
end;
$$;

revoke all on function public.retry_email(uuid) from public, anon;
grant execute on function public.retry_email(uuid) to authenticated;
