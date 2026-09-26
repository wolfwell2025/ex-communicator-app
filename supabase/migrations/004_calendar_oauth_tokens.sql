-- Ex Communicator: multi-calendar OAuth connections + encrypted tokens
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 002_calendar_events.sql
--
-- Model: one row per selected calendar (personal, work, family shared, …).
-- Same Google account can yield multiple rows. Tokens are AES-GCM encrypted
-- by the app; client list queries never select enc columns.

-- Allow multiple calendars per user (drop single-provider unique)
alter table public.personal_calendar_connections
  drop constraint if exists personal_calendar_connections_user_id_provider_key;

alter table public.personal_calendar_connections
  add column if not exists label text,
  add column if not exists sync_enabled boolean not null default true,
  add column if not exists access_token_enc text,
  add column if not exists refresh_token_enc text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists scopes text;

comment on column public.personal_calendar_connections.label is
  'User-facing name, e.g. Personal, Work, Kids schedule';
comment on column public.personal_calendar_connections.sync_enabled is
  'When false, connection stays linked but sync/import is paused';
comment on column public.personal_calendar_connections.access_token_enc is
  'AES-GCM ciphertext of Google access token; server-only';
comment on column public.personal_calendar_connections.refresh_token_enc is
  'AES-GCM ciphertext of Google refresh token; server-only';

-- One connection per (user, provider, account, calendar id)
create unique index if not exists personal_calendar_connections_user_cal_uidx
  on public.personal_calendar_connections (
    user_id,
    provider,
    (coalesce(external_account_email, '')),
    (coalesce(external_calendar_id, ''))
  );

-- Unique sync key for imported events per connection
create unique index if not exists calendar_events_connection_external_uidx
  on public.calendar_events (connection_id, external_id)
  where connection_id is not null and external_id is not null;

create index if not exists calendar_events_source_external_idx
  on public.calendar_events (source, external_id)
  where external_id is not null;

create index if not exists personal_calendar_connections_sync_idx
  on public.personal_calendar_connections (user_id, sync_enabled, status);

-- HARD PRIVACY: Google/Apple/Outlook synced events MUST insert as private.
-- Co-parent never sees them until an explicit propose → accept update in-app.
create or replace function public.enforce_imported_calendar_private()
returns trigger
language plpgsql
as $$
begin
  if new.source in ('google', 'apple', 'outlook') then
    new.visibility := 'private';
    new.proposed_at := null;
    new.proposed_by := null;
    new.accepted_at := null;
    new.accepted_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_imported_private on public.calendar_events;
create trigger calendar_events_imported_private
  before insert on public.calendar_events
  for each row
  execute function public.enforce_imported_calendar_private();

comment on function public.enforce_imported_calendar_private() is
  'Imported personal-calendar events always insert as private. Sharing is only via later propose/accept updates.';
