-- Ex Communicator: co-parent household invites
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 001_households_messages.sql

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null
    check (char_length(trim(email)) > 3 and char_length(email) <= 320),
  email_normalized text not null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days')
);

create index if not exists household_invites_household_idx
  on public.household_invites (household_id, status);

create index if not exists household_invites_email_idx
  on public.household_invites (email_normalized, status);

create unique index if not exists household_invites_pending_unique
  on public.household_invites (household_id, email_normalized)
  where status = 'pending';

alter table public.household_invites enable row level security;

-- Members can see invites for their household
drop policy if exists "household_invites_select_member" on public.household_invites;
create policy "household_invites_select_member"
  on public.household_invites for select
  to authenticated
  using (public.is_household_member(household_id));

-- No direct client insert/update/delete — use RPCs (security definer)
revoke insert, update, delete on public.household_invites from authenticated, anon;
grant select on public.household_invites to authenticated;

-- ---------------------------------------------------------------------------
-- Create invite (caller must be household member)
-- ---------------------------------------------------------------------------

create or replace function public.create_household_invite(
  p_household_id uuid,
  p_email text
)
returns public.household_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(p_email));
  v_row public.household_invites;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_household_member(p_household_id) then
    raise exception 'Not a household member';
  end if;

  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'Enter a valid email address';
  end if;

  -- Avoid inviting yourself
  if exists (
    select 1 from public.profiles p
    where p.id = v_uid and lower(trim(coalesce(p.email, ''))) = v_email
  ) then
    raise exception 'You cannot invite your own email';
  end if;

  -- Already a member with that email?
  if exists (
    select 1
    from public.household_members hm
    join public.profiles p on p.id = hm.user_id
    where hm.household_id = p_household_id
      and lower(trim(coalesce(p.email, ''))) = v_email
  ) then
    raise exception 'That person is already in this household';
  end if;

  -- Revoke any prior pending invite for same email+household, then insert fresh
  update public.household_invites
  set status = 'revoked'
  where household_id = p_household_id
    and email_normalized = v_email
    and status = 'pending';

  insert into public.household_invites (
    household_id,
    email,
    email_normalized,
    invited_by,
    status
  )
  values (
    p_household_id,
    trim(p_email),
    v_email,
    v_uid,
    'pending'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_household_invite(uuid, text) from public;
grant execute on function public.create_household_invite(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Accept invite by token (invitee must be signed in with matching email)
-- ---------------------------------------------------------------------------

create or replace function public.accept_household_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_invite public.household_invites;
  v_solo uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_token is null or length(trim(p_token)) < 8 then
    raise exception 'Invalid invite link';
  end if;

  select email into v_email from auth.users where id = v_uid;
  v_email := lower(trim(coalesce(v_email, '')));

  select * into v_invite
  from public.household_invites
  where token = trim(p_token)
  for update;

  if not found then
    raise exception 'Invite not found';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'Invite is no longer pending';
  end if;

  if v_invite.expires_at < now() then
    update public.household_invites
    set status = 'expired'
    where id = v_invite.id;
    raise exception 'Invite has expired';
  end if;

  if v_email = '' or v_email <> v_invite.email_normalized then
    raise exception 'Sign in with % to accept this invite', v_invite.email;
  end if;

  -- Ensure profile exists
  perform public.ensure_profile();

  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, v_uid, 'parent')
  on conflict (household_id, user_id) do nothing;

  update public.household_invites
  set
    status = 'accepted',
    accepted_at = now(),
    accepted_by = v_uid
  where id = v_invite.id;

  -- Leave empty solo households so ensureHousehold lands on the shared one
  for v_solo in
    select hm.household_id
    from public.household_members hm
    where hm.user_id = v_uid
      and hm.household_id <> v_invite.household_id
      and not exists (
        select 1
        from public.household_members other
        where other.household_id = hm.household_id
          and other.user_id <> v_uid
      )
  loop
    delete from public.household_members
    where household_id = v_solo and user_id = v_uid;
  end loop;

  return v_invite.household_id;
end;
$$;

revoke all on function public.accept_household_invite(text) from public;
grant execute on function public.accept_household_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Revoke pending invite
-- ---------------------------------------------------------------------------

create or replace function public.revoke_household_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_household_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select household_id into v_household_id
  from public.household_invites
  where id = p_invite_id;

  if v_household_id is null then
    raise exception 'Invite not found';
  end if;

  if not public.is_household_member(v_household_id) then
    raise exception 'Not a household member';
  end if;

  update public.household_invites
  set status = 'revoked'
  where id = p_invite_id and status = 'pending';
end;
$$;

revoke all on function public.revoke_household_invite(uuid) from public;
grant execute on function public.revoke_household_invite(uuid) to authenticated;

-- Peek invite metadata by token (for accept page before/after login)
create or replace function public.get_household_invite(p_token text)
returns table (
  id uuid,
  household_id uuid,
  household_name text,
  email text,
  status text,
  expires_at timestamptz,
  invited_by_label text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    i.id,
    i.household_id,
    h.name as household_name,
    i.email,
    case
      when i.status = 'pending' and i.expires_at < now() then 'expired'
      else i.status
    end as status,
    i.expires_at,
    coalesce(p.display_name, p.email, 'A co-parent') as invited_by_label
  from public.household_invites i
  join public.households h on h.id = i.household_id
  left join public.profiles p on p.id = i.invited_by
  where i.token = trim(p_token);
end;
$$;

revoke all on function public.get_household_invite(text) from public;
grant execute on function public.get_household_invite(text) to authenticated, anon;
