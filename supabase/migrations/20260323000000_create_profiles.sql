-- Create the public.profiles table, mirroring auth.users rows.
-- A trigger auto-inserts a row whenever a new auth user is created.

create table if not exists public.profiles (
  id            uuid        primary key references auth.users (id) on delete cascade,
  username      text        unique,
  display_name  text,
  role          text        not null default 'manager',
  branch        text,
  created_at    timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- Users can read their own profile (used by middleware to check role)
create policy "Users can read own profile"
  on public.profiles
  for select
  using (auth.uid() = id);

-- Only service-role (admin API) may insert/update/delete profiles.
-- The trigger below uses security definer so it runs as the table owner,
-- which has full access regardless of RLS.

-- Trigger function: insert a skeleton profile on new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    new.raw_user_meta_data ->> 'display_name',
    coalesce(new.raw_user_meta_data ->> 'role', 'manager')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Fire the trigger after every new auth user insert
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
