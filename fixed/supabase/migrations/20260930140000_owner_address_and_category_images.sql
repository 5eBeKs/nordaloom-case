-- The owner account is the shop's own address.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case when lower(new.email) = 'owner@nordaloom.example' then 'owner' else 'customer' end
  );
  return new;
end;
$$;

-- Only the shop address holds the owner role; promote it if it already exists.
update public.profiles p
set role = case when lower(u.email) = 'owner@nordaloom.example' then 'owner' else 'customer' end
from auth.users u
where u.id = p.id;

-- A photo for each category tile (storage path in the product-images bucket).
alter table public.categories add column if not exists image text;

comment on column public.products.images is
  'Image paths in the product-images bucket (or absolute URLs), in display order.';
