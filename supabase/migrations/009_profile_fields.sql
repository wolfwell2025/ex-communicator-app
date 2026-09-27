-- Ex Communicator: profile phone + avatar storage
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Requires 001_households_messages.sql (profiles table + RLS)

-- ---------------------------------------------------------------------------
-- Profile columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists phone text
    check (phone is null or char_length(trim(phone)) <= 40);

alter table public.profiles
  add column if not exists avatar_path text
    check (avatar_path is null or char_length(trim(avatar_path)) <= 500);

-- RLS already has profiles_update_own (id = auth.uid()); no policy change needed.
-- grant select, update on profiles already exists from 001.

-- ---------------------------------------------------------------------------
-- Avatars storage bucket (private; signed URLs; images only, 2 MiB)
-- Path convention: {user_id}/{uuid}-{safe_file_name}
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152, -- 2 MiB
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- SELECT: owner, or household mates (so co-parent labels can show photos later)
drop policy if exists "avatars_storage_select" on storage.objects;
create policy "avatars_storage_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.household_members me
        join public.household_members them
          on them.household_id = me.household_id
        where me.user_id = auth.uid()
          and them.user_id::text = (storage.foldername(name))[1]
      )
    )
  );

drop policy if exists "avatars_storage_insert" on storage.objects;
create policy "avatars_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_storage_update" on storage.objects;
create policy "avatars_storage_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_storage_delete" on storage.objects;
create policy "avatars_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
