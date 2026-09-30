-- Messages sent through the contact form. The owner reads and answers them in
-- the admin (answering is done by email for now; the admin marks them answered).

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  topic text not null check (topic in ('order', 'returns', 'sizing', 'care', 'wholesale', 'other')),
  order_number text check (order_number is null or char_length(order_number) <= 40),
  message text not null check (char_length(message) between 1 and 5000),
  -- Signed-in senders are linked to their account.
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'read', 'answered')),
  owner_note text check (owner_note is null or char_length(owner_note) <= 2000),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index contact_messages_created_idx on public.contact_messages (created_at desc);
create index contact_messages_email_idx on public.contact_messages (lower(email), created_at desc);

alter table public.contact_messages enable row level security;

create policy "Owner reads messages" on public.contact_messages
  for select to authenticated using (public.is_owner());
create policy "Owner updates messages" on public.contact_messages
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "Owner deletes messages" on public.contact_messages
  for delete to authenticated using (public.is_owner());

-- Anyone can send a message; a few per hour per address, to keep spam down.
create or replace function public.send_contact_message(p_name text, p_email text, p_topic text, p_order_number text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_message text := trim(coalesce(p_message, ''));
  v_order text := nullif(upper(trim(coalesce(p_order_number, ''))), '');
begin
  if v_name = '' or char_length(v_name) > 200 then raise exception 'invalid_name'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then raise exception 'invalid_email'; end if;
  if p_topic not in ('order', 'returns', 'sizing', 'care', 'wholesale', 'other') then raise exception 'invalid_topic'; end if;
  if v_message = '' or char_length(v_message) > 5000 then raise exception 'invalid_message'; end if;
  if char_length(v_order) > 40 then raise exception 'invalid_order'; end if;
  if (select count(*) from public.contact_messages
      where lower(email) = v_email and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too_many';
  end if;
  if (select count(*) from public.contact_messages where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'too_many';
  end if;

  insert into public.contact_messages (name, email, topic, order_number, message, user_id)
  values (v_name, v_email, p_topic, v_order, v_message, auth.uid());
end;
$$;

revoke all on function public.send_contact_message(text, text, text, text, text) from public;
grant execute on function public.send_contact_message(text, text, text, text, text) to anon, authenticated;
