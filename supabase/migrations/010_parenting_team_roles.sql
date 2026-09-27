-- Ex Communicator: Parenting team roles (user-facing rename; DB table names stay)
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 001_households_messages.sql
--
-- Naming note (2026-09-27):
--   User-facing copy uses "Parenting team" (and variants). Database tables,
--   columns, RPCs, and TypeScript identifiers keep `household` /
--   `household_*` names to avoid a painful rename across RLS, Storage paths,
--   and foreign keys. See PARENTING-TEAM.md.

-- ---------------------------------------------------------------------------
-- Expand household_members.role: parent|other → six roles
-- ---------------------------------------------------------------------------

-- Drop legacy check (default Postgres name: {table}_{column}_check)
alter table public.household_members
  drop constraint if exists household_members_role_check;

-- Migrate legacy "other" before adding the new constraint
update public.household_members
set role = 'caregiver'
where role = 'other';

alter table public.household_members
  add constraint household_members_role_check
  check (
    role in (
      'parent',
      'caregiver',
      'legal',
      'kid',
      'grandparent',
      'family_member'
    )
  );

-- ---------------------------------------------------------------------------
-- Default parenting team name for new creates
-- ---------------------------------------------------------------------------

create or replace function public.create_household(
  p_name text default 'Our parenting team'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_household_id uuid;
  v_name text := coalesce(nullif(trim(p_name), ''), 'Our parenting team');
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

-- ---------------------------------------------------------------------------
-- Members can update parenting team name; members can update their own role
-- ---------------------------------------------------------------------------

drop policy if exists "households_update_member" on public.households;
create policy "households_update_member"
  on public.households for update
  to authenticated
  using (public.is_household_member(id))
  with check (public.is_household_member(id));

grant update on public.households to authenticated;

drop policy if exists "household_members_update_own" on public.household_members;
create policy "household_members_update_own"
  on public.household_members for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant update on public.household_members to authenticated;
