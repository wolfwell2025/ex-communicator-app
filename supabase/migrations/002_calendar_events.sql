-- Ex Communicator: custody calendar with private vs shared privacy
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 001_households_messages.sql (is_household_member helper)
--
-- Privacy model:
--   private  — only the creator can SELECT (co-parent sees NOTHING)
--   pending  — proposed to household; creator always sees it; other members
--              may SELECT only to accept/decline (shown in Share requests UI,
--              NOT on the shared month grid until accepted)
--   shared   — all household members see it on the shared calendar
-- Google / Apple / Outlook OAuth sync is stubbed via personal_calendar_connections.

-- ---------------------------------------------------------------------------
-- Personal calendar connections (schema now; OAuth sync later)
-- ---------------------------------------------------------------------------

create table if not exists public.personal_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null
    check (provider in ('google', 'apple', 'outlook', 'other')),
  status text not null default 'disconnected'
    check (status in ('disconnected', 'pending', 'connected', 'error')),
  external_account_email text,
  external_calendar_id text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists personal_calendar_connections_user_idx
  on public.personal_calendar_connections (user_id);

alter table public.personal_calendar_connections enable row level security;

drop policy if exists "pcc_select_own" on public.personal_calendar_connections;
create policy "pcc_select_own"
  on public.personal_calendar_connections for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "pcc_insert_own" on public.personal_calendar_connections;
create policy "pcc_insert_own"
  on public.personal_calendar_connections for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "pcc_update_own" on public.personal_calendar_connections;
create policy "pcc_update_own"
  on public.personal_calendar_connections for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "pcc_delete_own" on public.personal_calendar_connections;
create policy "pcc_delete_own"
  on public.personal_calendar_connections for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.personal_calendar_connections to authenticated;

-- ---------------------------------------------------------------------------
-- Calendar events (household-scoped; visibility gates co-parent access)
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null
    check (char_length(trim(title)) > 0 and char_length(title) <= 200),
  description text
    check (description is null or char_length(description) <= 5000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  location text
    check (location is null or char_length(location) <= 300),
  event_type text not null default 'other'
    check (event_type in ('parenting_time', 'school', 'medical', 'activity', 'other')),
  -- private | pending (proposed) | shared (accepted / household-visible)
  visibility text not null default 'private'
    check (visibility in ('private', 'pending', 'shared')),
  proposed_at timestamptz,
  proposed_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  -- future personal-calendar sync
  source text not null default 'manual'
    check (source in ('manual', 'google', 'apple', 'outlook', 'other')),
  external_id text,
  connection_id uuid references public.personal_calendar_connections (id) on delete set null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_ends_after_starts check (ends_at >= starts_at)
);

create index if not exists calendar_events_household_starts_idx
  on public.calendar_events (household_id, starts_at);

create index if not exists calendar_events_household_visibility_idx
  on public.calendar_events (household_id, visibility);

create index if not exists calendar_events_created_by_idx
  on public.calendar_events (created_by);

-- Keep updated_at fresh on row changes
create or replace function public.set_calendar_events_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists calendar_events_set_updated_at on public.calendar_events;
create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row
  execute function public.set_calendar_events_updated_at();

create or replace function public.set_pcc_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pcc_set_updated_at on public.personal_calendar_connections;
create trigger pcc_set_updated_at
  before update on public.personal_calendar_connections
  for each row
  execute function public.set_pcc_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.calendar_events enable row level security;

-- SELECT:
--   * creator always sees own events (private / pending / shared)
--   * household members see shared events on the household calendar
--   * household members see pending proposals (for accept/decline inbox ONLY;
--     UI must not paint them on the shared month grid until accepted)
--   * private events of others: NOT visible (default NOTHING)
drop policy if exists "calendar_events_select_visible" on public.calendar_events;
create policy "calendar_events_select_visible"
  on public.calendar_events for select
  to authenticated
  using (
    created_by = auth.uid()
    or (
      public.is_household_member(household_id)
      and visibility in ('shared', 'pending')
    )
  );

-- INSERT: member creates as self; may start private or pending (not shared
-- without going through accept — shared on insert only allowed for creator's
-- own immediate private/pending; clients set visibility private|pending)
drop policy if exists "calendar_events_insert_member" on public.calendar_events;
create policy "calendar_events_insert_member"
  on public.calendar_events for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_household_member(household_id)
    and visibility in ('private', 'pending')
  );

-- UPDATE:
--   * creator may edit content and propose (private→pending) or cancel
--     (pending→private) or soft-unshare (shared→private)
--   * other household members may ONLY accept (pending→shared) or decline
--     (pending→private) — enforced via with-check that non-owners leave
--     content fields alone is app-level; RLS allows member updates when
--     visibility is pending or (owner always)
drop policy if exists "calendar_events_update_owner_or_accept" on public.calendar_events;
create policy "calendar_events_update_owner_or_accept"
  on public.calendar_events for update
  to authenticated
  using (
    created_by = auth.uid()
    or (
      public.is_household_member(household_id)
      and visibility = 'pending'
    )
  )
  with check (
    created_by = auth.uid()
    or (
      public.is_household_member(household_id)
      and visibility in ('shared', 'private')
    )
  );

-- DELETE: only the creator (private personal / withdraw proposal / remove shared)
drop policy if exists "calendar_events_delete_owner" on public.calendar_events;
create policy "calendar_events_delete_owner"
  on public.calendar_events for delete
  to authenticated
  using (created_by = auth.uid());

grant select, insert, update, delete on public.calendar_events to authenticated;


-- ---------------------------------------------------------------------------
-- Realtime (optional; safe if already added)
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.calendar_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
