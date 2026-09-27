-- Ex Communicator: Outlook / Microsoft 365 calendar OAuth (provider already in 002)
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 002_calendar_events.sql + 004_calendar_oauth_tokens.sql + 007_calendar_suggestions_and_export.sql
--
-- Schema already allows provider='outlook' and source='outlook'. This migration
-- documents Outlook bi-directional sync (import + export_enabled) and keeps the
-- private-import trigger aligned. No breaking column changes.

-- Re-assert: imported Google / Apple / Outlook events insert as private only.
-- Sharing is only via later propose → accept updates in-app.
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
  'Imported personal-calendar events (google/apple/outlook) always insert as private. Sharing is only via later propose/accept updates.';

comment on column public.personal_calendar_connections.export_enabled is
  'When true, app-created events owned by the user are pushed to this Google or Outlook calendar. Default off (opt-in). Inbound sync_enabled is independent.';

comment on column public.personal_calendar_connections.access_token_enc is
  'AES-GCM ciphertext of provider access token (Google or Microsoft); server-only';
comment on column public.personal_calendar_connections.refresh_token_enc is
  'AES-GCM ciphertext of provider refresh token (Google or Microsoft); server-only';

-- Ensure export index exists (idempotent with 007)
create index if not exists personal_calendar_connections_export_idx
  on public.personal_calendar_connections (user_id, export_enabled, status)
  where export_enabled = true;

create index if not exists personal_calendar_connections_provider_idx
  on public.personal_calendar_connections (user_id, provider, status);
