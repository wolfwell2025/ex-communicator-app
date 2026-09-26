-- Ex Communicator: calendar suggestions (from messages/docs) + Google export toggle
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 002_calendar_events.sql + 004_calendar_oauth_tokens.sql + 006_message_threads.sql
--
-- Feature A: calendar_suggestions stores confirmed date/time prompts so we do not
-- re-prompt forever after accept/dismiss.
-- Feature B: export_enabled on personal_calendar_connections (default off).

-- ---------------------------------------------------------------------------
-- Export toggle on Google connections (inbound sync_enabled unchanged)
-- ---------------------------------------------------------------------------

alter table public.personal_calendar_connections
  add column if not exists export_enabled boolean not null default false;

comment on column public.personal_calendar_connections.export_enabled is
  'When true, app-created events owned by the user are pushed to this Google calendar. Default off (opt-in). Inbound sync_enabled is independent.';

create index if not exists personal_calendar_connections_export_idx
  on public.personal_calendar_connections (user_id, export_enabled, status)
  where export_enabled = true;

-- ---------------------------------------------------------------------------
-- Calendar suggestions (message confirmations + document dates)
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_suggestions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  source_type text not null
    check (source_type in ('message', 'document')),
  -- Stable dedupe key, e.g. msg:<proposalId>+<confirmId> or doc:<documentId>:<starts_at>
  source_key text not null
    check (char_length(trim(source_key)) > 0 and char_length(source_key) <= 500),
  source_ids text[] not null default '{}',
  title text not null
    check (char_length(trim(title)) > 0 and char_length(title) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'dismissed')),
  suggested_visibility text not null default 'private'
    check (suggested_visibility in ('private', 'pending')),
  created_for uuid not null references auth.users (id) on delete cascade,
  proposer_id uuid references auth.users (id) on delete set null,
  event_id uuid references public.calendar_events (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_suggestions_ends_after_starts check (ends_at >= starts_at),
  constraint calendar_suggestions_unique_for_user unique (created_for, source_key)
);

create index if not exists calendar_suggestions_household_pending_idx
  on public.calendar_suggestions (household_id, created_for, status)
  where status = 'pending';

create index if not exists calendar_suggestions_created_for_idx
  on public.calendar_suggestions (created_for, created_at desc);

create or replace function public.set_calendar_suggestions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists calendar_suggestions_set_updated_at on public.calendar_suggestions;
create trigger calendar_suggestions_set_updated_at
  before update on public.calendar_suggestions
  for each row
  execute function public.set_calendar_suggestions_updated_at();

alter table public.calendar_suggestions enable row level security;

-- Owner (created_for) can see and update their suggestions; household members
-- who created a proposal may also see ones they proposed (proposer_id).
drop policy if exists "calendar_suggestions_select_own" on public.calendar_suggestions;
create policy "calendar_suggestions_select_own"
  on public.calendar_suggestions for select
  to authenticated
  using (
    created_for = auth.uid()
    or proposer_id = auth.uid()
    or (
      public.is_household_member(household_id)
      and created_for = auth.uid()
    )
  );

-- Household members may insert suggestions for any member of that household
-- (scanner creates rows for confirmer and proposer after a yes in a thread).
drop policy if exists "calendar_suggestions_insert_member" on public.calendar_suggestions;
drop policy if exists "calendar_suggestions_insert_for_member" on public.calendar_suggestions;
create policy "calendar_suggestions_insert_for_member"
  on public.calendar_suggestions for insert
  to authenticated
  with check (
    public.is_household_member(household_id)
    and exists (
      select 1 from public.household_members hm
      where hm.household_id = calendar_suggestions.household_id
        and hm.user_id = calendar_suggestions.created_for
    )
  );

drop policy if exists "calendar_suggestions_update_own" on public.calendar_suggestions;
create policy "calendar_suggestions_update_own"
  on public.calendar_suggestions for update
  to authenticated
  using (created_for = auth.uid())
  with check (created_for = auth.uid());

drop policy if exists "calendar_suggestions_delete_own" on public.calendar_suggestions;
create policy "calendar_suggestions_delete_own"
  on public.calendar_suggestions for delete
  to authenticated
  using (created_for = auth.uid());

grant select, insert, update, delete on public.calendar_suggestions to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.calendar_suggestions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
