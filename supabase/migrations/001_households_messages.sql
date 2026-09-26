-- Ex Communicator: households + secure messaging
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Uses anon/authenticated roles only (no service_role required)

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our household',
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('parent', 'other')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete restrict,
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 10000),
  created_at timestamptz not null default now()
);

create index if not exists messages_household_created_idx
  on public.messages (household_id, created_at);

create index if not exists household_members_user_idx
  on public.household_members (user_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

-- Create household and add the caller as a parent member.
create or replace function public.create_household(p_name text default 'Our household')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_household_id uuid;
  v_name text := coalesce(nullif(trim(p_name), ''), 'Our household');
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.households (name, created_by)
  values (v_name, v_uid)
  returning id into v_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, v_uid, 'parent');

  return v_household_id;
end;
$$;

revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;

-- Ensure a profile row exists for the current user (covers users created before the trigger).
create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.profiles (id, email, display_name)
  values (v_uid, v_email, split_part(coalesce(v_email, 'user'), '@', 1))
  on conflict (id) do update
    set email = excluded.email
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.ensure_profile() from public;
grant execute on function public.ensure_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- Auth → profile trigger
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill profiles for any existing auth users
insert into public.profiles (id, email, display_name)
select
  u.id,
  u.email,
  split_part(coalesce(u.email, 'user'), '@', 1)
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.messages enable row level security;

-- Profiles: users can read members of shared households + themselves; update own
drop policy if exists "profiles_select_self_or_household" on public.profiles;
create policy "profiles_select_self_or_household"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.household_members me
      join public.household_members them
        on them.household_id = me.household_id
      where me.user_id = auth.uid()
        and them.user_id = profiles.id
    )
  );

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Households: members can select; insert only as creator (RPC preferred)
drop policy if exists "households_select_member" on public.households;
create policy "households_select_member"
  on public.households for select
  to authenticated
  using (public.is_household_member(id));

drop policy if exists "households_insert_creator" on public.households;
create policy "households_insert_creator"
  on public.households for insert
  to authenticated
  with check (created_by = auth.uid());

-- Household members: members see roster
drop policy if exists "household_members_select_member" on public.household_members;
create policy "household_members_select_member"
  on public.household_members for select
  to authenticated
  using (public.is_household_member(household_id));

-- Messages: members select + insert; no update/delete policies (immutable for clients)
drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member"
  on public.messages for select
  to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_household_member(household_id)
  );

-- Explicitly deny update/delete for authenticated clients (no policies = denied under RLS)
revoke update, delete on public.messages from authenticated, anon;
grant select, insert on public.messages to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert on public.households to authenticated;
grant select on public.household_members to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (optional; safe if already added)
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
