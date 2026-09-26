-- Ex Communicator: household documents vault + Storage bucket
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 001_households_messages.sql (is_household_member helper)
--
-- Privacy model (same labels as calendar; default differs for decree vault):
--   private  — only the uploader can SELECT / download
--   pending  — proposed to household; uploader always sees it; other members
--              may SELECT to accept/decline (Share requests UI)
--   shared   — all household members see and download
-- Default new uploads: shared (both parents need decrees/school forms).
-- Optional: keep private via UI checkbox, then Propose → Accept.

-- ---------------------------------------------------------------------------
-- Documents table
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null
    check (char_length(trim(title)) > 0 and char_length(title) <= 200),
  description text
    check (description is null or char_length(description) <= 5000),
  category text not null default 'other'
    check (category in ('decree', 'school', 'medical', 'legal', 'expense', 'other')),
  -- Storage object path inside bucket "documents" (not a public URL)
  file_path text not null
    check (char_length(trim(file_path)) > 0 and char_length(file_path) <= 1000),
  file_name text not null
    check (char_length(trim(file_name)) > 0 and char_length(file_name) <= 300),
  mime_type text not null
    check (char_length(trim(mime_type)) > 0 and char_length(mime_type) <= 200),
  size_bytes bigint not null
    check (size_bytes >= 0 and size_bytes <= 26214400), -- 25 MiB hard cap
  visibility text not null default 'shared'
    check (visibility in ('private', 'pending', 'shared')),
  proposed_at timestamptz,
  proposed_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  uploaded_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_household_created_idx
  on public.documents (household_id, created_at desc);

create index if not exists documents_household_visibility_idx
  on public.documents (household_id, visibility);

create index if not exists documents_household_category_idx
  on public.documents (household_id, category);

create index if not exists documents_uploaded_by_idx
  on public.documents (uploaded_by);

create index if not exists documents_file_path_idx
  on public.documents (file_path);

create or replace function public.set_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row
  execute function public.set_documents_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security (table)
-- ---------------------------------------------------------------------------

alter table public.documents enable row level security;

-- SELECT: uploader always; household members see shared + pending (for accept UI)
drop policy if exists "documents_select_visible" on public.documents;
create policy "documents_select_visible"
  on public.documents for select
  to authenticated
  using (
    uploaded_by = auth.uid()
    or (
      public.is_household_member(household_id)
      and visibility in ('shared', 'pending')
    )
  );

-- INSERT: member as self; may start shared (default vault), private, or pending
drop policy if exists "documents_insert_member" on public.documents;
create policy "documents_insert_member"
  on public.documents for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.is_household_member(household_id)
    and visibility in ('private', 'pending', 'shared')
  );

-- UPDATE: owner always; other members only when pending (accept → shared / decline → private)
drop policy if exists "documents_update_owner_or_accept" on public.documents;
create policy "documents_update_owner_or_accept"
  on public.documents for update
  to authenticated
  using (
    uploaded_by = auth.uid()
    or (
      public.is_household_member(household_id)
      and visibility = 'pending'
    )
  )
  with check (
    uploaded_by = auth.uid()
    or (
      public.is_household_member(household_id)
      and visibility in ('shared', 'private')
    )
  );

-- DELETE: uploader only
drop policy if exists "documents_delete_owner" on public.documents;
create policy "documents_delete_owner"
  on public.documents for delete
  to authenticated
  using (uploaded_by = auth.uid());

grant select, insert, update, delete on public.documents to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket (private; access via RLS + signed URLs / authenticated client)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400, -- 25 MiB
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: {household_id}/{user_id}/{uuid}-{safe_file_name}
-- folder[1] = household_id, folder[2] = uploader user_id

drop policy if exists "documents_storage_select" on storage.objects;
create policy "documents_storage_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1
      from public.documents d
      where d.file_path = name
        and (
          d.uploaded_by = auth.uid()
          or (
            public.is_household_member(d.household_id)
            and d.visibility in ('shared', 'pending')
          )
        )
    )
  );

drop policy if exists "documents_storage_insert" on storage.objects;
create policy "documents_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] is not null
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "documents_storage_update" on storage.objects;
create policy "documents_storage_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "documents_storage_delete" on storage.objects;
create policy "documents_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1
        from public.documents d
        where d.file_path = name
          and d.uploaded_by = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime (optional; safe if already added)
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.documents;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
