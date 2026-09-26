-- Ex Communicator: message threads (OFW-style subjects + recipients)
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 001_households_messages.sql (is_household_member helper)
--
-- Model:
--   message_threads     — subject + household, one conversation
--   thread_participants — who can see / reply (To: picker)
--   messages.thread_id  — messages belong to a thread
-- Existing flat household messages are migrated into one "Household messages"
-- thread per household with all current members as participants.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  subject text not null
    check (char_length(trim(subject)) > 0 and char_length(subject) <= 200),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_threads_household_updated_idx
  on public.message_threads (household_id, updated_at desc);

create table if not exists public.thread_participants (
  thread_id uuid not null references public.message_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists thread_participants_user_idx
  on public.thread_participants (user_id);

-- Add thread_id to messages (nullable until backfill)
alter table public.messages
  add column if not exists thread_id uuid references public.message_threads (id) on delete cascade;

create index if not exists messages_thread_created_idx
  on public.messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_thread_participant(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = auth.uid()
  );
$$;

revoke all on function public.is_thread_participant(uuid) from public;
grant execute on function public.is_thread_participant(uuid) to authenticated;

create or replace function public.set_message_threads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists message_threads_set_updated_at on public.message_threads;
create trigger message_threads_set_updated_at
  before update on public.message_threads
  for each row
  execute function public.set_message_threads_updated_at();

-- Bump thread updated_at when a message is inserted
create or replace function public.bump_thread_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.thread_id is not null then
    update public.message_threads
    set updated_at = now()
    where id = new.thread_id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_bump_thread on public.messages;
create trigger messages_bump_thread
  after insert on public.messages
  for each row
  execute function public.bump_thread_on_message();

-- ---------------------------------------------------------------------------
-- Migrate existing flat messages → one thread per household
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_thread_id uuid;
  v_creator uuid;
begin
  for r in
    select h.id as household_id, h.created_by
    from public.households h
    where exists (
      select 1 from public.messages m
      where m.household_id = h.id and m.thread_id is null
    )
    or not exists (
      select 1 from public.message_threads t where t.household_id = h.id
    )
  loop
    -- Prefer an existing legacy thread if re-run
    select id into v_thread_id
    from public.message_threads
    where household_id = r.household_id
      and subject = 'Household messages'
    limit 1;

    if v_thread_id is null then
      -- Only create a legacy thread if there are orphan messages
      if exists (
        select 1 from public.messages m
        where m.household_id = r.household_id and m.thread_id is null
      ) then
        select coalesce(
          (select m.sender_id from public.messages m
           where m.household_id = r.household_id and m.thread_id is null
           order by m.created_at asc limit 1),
          r.created_by
        ) into v_creator;

        insert into public.message_threads (household_id, subject, created_by)
        values (r.household_id, 'Household messages', v_creator)
        returning id into v_thread_id;

        insert into public.thread_participants (thread_id, user_id)
        select v_thread_id, hm.user_id
        from public.household_members hm
        where hm.household_id = r.household_id
        on conflict do nothing;

        update public.messages
        set thread_id = v_thread_id
        where household_id = r.household_id
          and thread_id is null;
      end if;
    else
      update public.messages
      set thread_id = v_thread_id
      where household_id = r.household_id
        and thread_id is null;

      insert into public.thread_participants (thread_id, user_id)
      select v_thread_id, hm.user_id
      from public.household_members hm
      where hm.household_id = r.household_id
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create thread with participants + optional first message
-- ---------------------------------------------------------------------------

create or replace function public.create_message_thread(
  p_household_id uuid,
  p_subject text,
  p_participant_ids uuid[],
  p_body text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_thread_id uuid;
  v_subject text := trim(p_subject);
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_ids uuid[];
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_household_member(p_household_id) then
    raise exception 'Not a household member';
  end if;

  if v_subject is null or char_length(v_subject) = 0 then
    raise exception 'Subject is required';
  end if;

  if char_length(v_subject) > 200 then
    raise exception 'Subject is too long';
  end if;

  -- Always include the sender; optionally all household members when empty To
  if p_participant_ids is null or coalesce(array_length(p_participant_ids, 1), 0) = 0 then
    select coalesce(array_agg(hm.user_id), array[v_uid])
    into v_ids
    from public.household_members hm
    where hm.household_id = p_household_id;
  else
    v_ids := p_participant_ids;
  end if;

  -- Ensure caller is a participant
  if not (v_uid = any (v_ids)) then
    v_ids := array_append(v_ids, v_uid);
  end if;

  -- Every participant must be a household member
  foreach v_id in array v_ids loop
    if not exists (
      select 1 from public.household_members hm
      where hm.household_id = p_household_id and hm.user_id = v_id
    ) then
      raise exception 'All recipients must be household members';
    end if;
  end loop;

  insert into public.message_threads (household_id, subject, created_by)
  values (p_household_id, v_subject, v_uid)
  returning id into v_thread_id;

  insert into public.thread_participants (thread_id, user_id)
  select distinct v_thread_id, x
  from unnest(v_ids) as x
  on conflict do nothing;

  if v_body is not null then
    if char_length(v_body) > 10000 then
      raise exception 'Message is too long';
    end if;
    insert into public.messages (household_id, sender_id, body, thread_id)
    values (p_household_id, v_uid, v_body, v_thread_id);
  end if;

  return v_thread_id;
end;
$$;

revoke all on function public.create_message_thread(uuid, text, uuid[], text) from public;
grant execute on function public.create_message_thread(uuid, text, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.message_threads enable row level security;
alter table public.thread_participants enable row level security;

drop policy if exists "message_threads_select_participant" on public.message_threads;
create policy "message_threads_select_participant"
  on public.message_threads for select
  to authenticated
  using (
    public.is_household_member(household_id)
    and public.is_thread_participant(id)
  );

drop policy if exists "message_threads_insert_member" on public.message_threads;
create policy "message_threads_insert_member"
  on public.message_threads for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_household_member(household_id)
  );

drop policy if exists "message_threads_update_participant" on public.message_threads;
create policy "message_threads_update_participant"
  on public.message_threads for update
  to authenticated
  using (
    public.is_household_member(household_id)
    and public.is_thread_participant(id)
  )
  with check (
    public.is_household_member(household_id)
    and public.is_thread_participant(id)
  );

drop policy if exists "thread_participants_select_member" on public.thread_participants;
create policy "thread_participants_select_member"
  on public.thread_participants for select
  to authenticated
  using (
    exists (
      select 1 from public.message_threads t
      where t.id = thread_participants.thread_id
        and public.is_household_member(t.household_id)
        and public.is_thread_participant(t.id)
    )
  );

-- Participants are written via security definer RPC; allow creator to insert self/others when inserting a thread directly
drop policy if exists "thread_participants_insert_member" on public.thread_participants;
create policy "thread_participants_insert_member"
  on public.thread_participants for insert
  to authenticated
  with check (
    exists (
      select 1 from public.message_threads t
      where t.id = thread_participants.thread_id
        and t.created_by = auth.uid()
        and public.is_household_member(t.household_id)
    )
    and exists (
      select 1 from public.message_threads t
      join public.household_members hm on hm.household_id = t.household_id
      where t.id = thread_participants.thread_id
        and hm.user_id = thread_participants.user_id
    )
  );

-- Tighten messages policies: participants of the thread (legacy null thread still household-wide)
drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member"
  on public.messages for select
  to authenticated
  using (
    public.is_household_member(household_id)
    and (
      thread_id is null
      or public.is_thread_participant(thread_id)
    )
  );

drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_household_member(household_id)
    and thread_id is not null
    and public.is_thread_participant(thread_id)
    and exists (
      select 1 from public.message_threads t
      where t.id = thread_id
        and t.household_id = messages.household_id
    )
  );

grant select, insert, update on public.message_threads to authenticated;
grant select, insert on public.thread_participants to authenticated;

-- Realtime for threads (optional)
do $$
begin
  alter publication supabase_realtime add table public.message_threads;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
