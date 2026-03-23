-- Require a home branch for every non-admin profile and allow auth metadata
-- to seed role/branch during auth user creation.

alter table public.profiles
  alter column role set default 'worker';

update public.profiles
set branch = upper(trim(branch))
where branch is not null;

alter table public.profiles
  drop constraint if exists profiles_home_branch_required;

alter table public.profiles
  add constraint profiles_home_branch_required
  check (
    role = 'admin'
    or nullif(btrim(coalesce(branch, '')), '') is not null
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, role, branch)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    new.raw_user_meta_data ->> 'display_name',
    coalesce(new.raw_user_meta_data ->> 'role', 'worker'),
    upper(nullif(btrim(new.raw_user_meta_data ->> 'branch'), ''))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
