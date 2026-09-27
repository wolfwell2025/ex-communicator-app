-- Ex Communicator: household shared expenses + reimbursement workflow
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 001_households_messages.sql (is_household_member helper)
-- Optional FK to documents (005_documents.sql) for receipt attachment
--
-- Model (OFW-style):
--   requester_id = who paid / who created the expense
--   amount_cents = total cost
--   share_cents  = amount requested from the co-parent (default half)
--   status: draft | requested | accepted | declined | paid | canceled
-- Expenses are household-visible once created (no private mode for MVP).

-- ---------------------------------------------------------------------------
-- Expenses table
-- ---------------------------------------------------------------------------

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null
    check (char_length(trim(title)) > 0 and char_length(title) <= 200),
  description text
    check (description is null or char_length(description) <= 5000),
  category text not null default 'other'
    check (category in ('medical', 'school', 'activity', 'childcare', 'clothing', 'other')),
  amount_cents integer not null
    check (amount_cents > 0 and amount_cents <= 100000000),
  currency text not null default 'USD'
    check (char_length(trim(currency)) = 3),
  incurred_on date not null,
  requester_id uuid not null references auth.users (id) on delete restrict,
  share_cents integer not null
    check (share_cents >= 0 and share_cents <= 100000000),
  status text not null default 'draft'
    check (status in ('draft', 'requested', 'accepted', 'declined', 'paid', 'canceled')),
  document_id uuid references public.documents (id) on delete set null,
  requested_at timestamptz,
  responded_at timestamptz,
  responded_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz,
  paid_noted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_share_lte_amount check (share_cents <= amount_cents)
);

create index if not exists expenses_household_incurred_idx
  on public.expenses (household_id, incurred_on desc);

create index if not exists expenses_household_status_idx
  on public.expenses (household_id, status);

create index if not exists expenses_requester_idx
  on public.expenses (requester_id);

create index if not exists expenses_document_idx
  on public.expenses (document_id)
  where document_id is not null;

create or replace function public.set_expenses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row
  execute function public.set_expenses_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.expenses enable row level security;

-- SELECT: all household members (expenses are shared records)
drop policy if exists "expenses_select_member" on public.expenses;
create policy "expenses_select_member"
  on public.expenses for select
  to authenticated
  using (public.is_household_member(household_id));

-- INSERT: member as requester; start as draft or requested
drop policy if exists "expenses_insert_member" on public.expenses;
create policy "expenses_insert_member"
  on public.expenses for insert
  to authenticated
  with check (
    requester_id = auth.uid()
    and public.is_household_member(household_id)
    and status in ('draft', 'requested')
  );

-- UPDATE: household members (app enforces allowed status transitions)
drop policy if exists "expenses_update_member" on public.expenses;
create policy "expenses_update_member"
  on public.expenses for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- DELETE: requester only (typically drafts / canceled)
drop policy if exists "expenses_delete_requester" on public.expenses;
create policy "expenses_delete_requester"
  on public.expenses for delete
  to authenticated
  using (requester_id = auth.uid());

grant select, insert, update, delete on public.expenses to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (optional; safe if already added)
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.expenses;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
