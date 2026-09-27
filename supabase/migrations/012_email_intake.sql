-- Ex Communicator: email intake (Gmail + Outlook mail)
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 001_households_messages.sql (profiles / auth.users)
--
-- HARD PRIVACY: imported email is ALWAYS private to the connecting user.
-- Co-parent never sees email_threads / email_messages via RLS.
-- Sharing is only via explicit in-app "Draft message from email" into Messages
-- (user chooses what text to send; raw mailbox content stays owner-private).

-- ---------------------------------------------------------------------------
-- Connections (one row per user + provider + account email)
-- ---------------------------------------------------------------------------

create table if not exists public.email_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null
    check (provider in ('gmail', 'outlook')),
  status text not null default 'disconnected'
    check (status in ('disconnected', 'pending', 'connected', 'error')),
  sync_enabled boolean not null default true,
  external_account_email text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_connections_user_provider_account_uidx
  on public.email_connections (
    user_id,
    provider,
    (coalesce(external_account_email, ''))
  );

create index if not exists email_connections_user_status_idx
  on public.email_connections (user_id, status, sync_enabled);

comment on table public.email_connections is
  'OAuth mail connections (Gmail / Outlook). Tokens AES-GCM encrypted by app. Owner-private.';
comment on column public.email_connections.access_token_enc is
  'AES-GCM ciphertext of provider access token; server-only';
comment on column public.email_connections.refresh_token_enc is
  'AES-GCM ciphertext of provider refresh token; server-only';

create or replace function public.set_email_connections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists email_connections_set_updated_at on public.email_connections;
create trigger email_connections_set_updated_at
  before update on public.email_connections
  for each row
  execute function public.set_email_connections_updated_at();

-- ---------------------------------------------------------------------------
-- Synced threads (metadata + snippet; owner-private)
-- ---------------------------------------------------------------------------

create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.email_connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null
    check (provider in ('gmail', 'outlook')),
  external_thread_id text not null
    check (char_length(trim(external_thread_id)) > 0 and char_length(external_thread_id) <= 500),
  subject text
    check (subject is null or char_length(subject) <= 1000),
  snippet text
    check (snippet is null or char_length(snippet) <= 2000),
  participants jsonb not null default '[]'::jsonb,
  last_message_at timestamptz,
  message_count integer not null default 0
    check (message_count >= 0),
  is_unread boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_threads_connection_external_uidx
  on public.email_threads (connection_id, external_thread_id);

create index if not exists email_threads_user_last_idx
  on public.email_threads (user_id, last_message_at desc nulls last);

create index if not exists email_threads_user_unread_idx
  on public.email_threads (user_id, is_unread)
  where is_unread = true;

comment on table public.email_threads is
  'Imported mailbox threads. Always private to user_id until user drafts into Messages.';

create or replace function public.set_email_threads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists email_threads_set_updated_at on public.email_threads;
create trigger email_threads_set_updated_at
  before update on public.email_threads
  for each row
  execute function public.set_email_threads_updated_at();

-- ---------------------------------------------------------------------------
-- Synced messages (body text; owner-private)
-- ---------------------------------------------------------------------------

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads (id) on delete cascade,
  connection_id uuid not null references public.email_connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null
    check (provider in ('gmail', 'outlook')),
  external_message_id text not null
    check (char_length(trim(external_message_id)) > 0 and char_length(external_message_id) <= 500),
  from_addr text
    check (from_addr is null or char_length(from_addr) <= 500),
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  subject text
    check (subject is null or char_length(subject) <= 1000),
  body_text text
    check (body_text is null or char_length(body_text) <= 100000),
  snippet text
    check (snippet is null or char_length(snippet) <= 2000),
  sent_at timestamptz,
  is_from_me boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_messages_connection_external_uidx
  on public.email_messages (connection_id, external_message_id);

create index if not exists email_messages_thread_sent_idx
  on public.email_messages (thread_id, sent_at asc nulls last);

create index if not exists email_messages_user_idx
  on public.email_messages (user_id, sent_at desc nulls last);

comment on table public.email_messages is
  'Imported mailbox messages. Owner-private. No household SELECT policies.';

create or replace function public.set_email_messages_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists email_messages_set_updated_at on public.email_messages;
create trigger email_messages_set_updated_at
  before update on public.email_messages
  for each row
  execute function public.set_email_messages_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owner-only (same spirit as calendar private-until-propose)
-- ---------------------------------------------------------------------------

alter table public.email_connections enable row level security;
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;

drop policy if exists "email_connections_select_own" on public.email_connections;
create policy "email_connections_select_own"
  on public.email_connections for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "email_connections_insert_own" on public.email_connections;
create policy "email_connections_insert_own"
  on public.email_connections for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "email_connections_update_own" on public.email_connections;
create policy "email_connections_update_own"
  on public.email_connections for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "email_connections_delete_own" on public.email_connections;
create policy "email_connections_delete_own"
  on public.email_connections for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "email_threads_select_own" on public.email_threads;
create policy "email_threads_select_own"
  on public.email_threads for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "email_threads_insert_own" on public.email_threads;
create policy "email_threads_insert_own"
  on public.email_threads for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "email_threads_update_own" on public.email_threads;
create policy "email_threads_update_own"
  on public.email_threads for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "email_threads_delete_own" on public.email_threads;
create policy "email_threads_delete_own"
  on public.email_threads for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "email_messages_select_own" on public.email_messages;
create policy "email_messages_select_own"
  on public.email_messages for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "email_messages_insert_own" on public.email_messages;
create policy "email_messages_insert_own"
  on public.email_messages for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "email_messages_update_own" on public.email_messages;
create policy "email_messages_update_own"
  on public.email_messages for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "email_messages_delete_own" on public.email_messages;
create policy "email_messages_delete_own"
  on public.email_messages for delete
  to authenticated
  using (user_id = auth.uid());
