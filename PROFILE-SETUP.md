# Profile setup

## 1. Run the SQL migration

Supabase Dashboard → **SQL Editor** → paste and **Run**:

[`supabase/migrations/009_profile_fields.sql`](supabase/migrations/009_profile_fields.sql)

Requires migration `001` (profiles table + `profiles_update_own` RLS).

This adds:

- Nullable `phone` and `avatar_path` on `public.profiles`
- Private Storage bucket `avatars` (2 MiB, JPEG/PNG/WebP/GIF)
- Storage RLS: users manage files under `{user_id}/…`; household mates can read for future labels

Existing RLS already lets users update only their own profile row (`id = auth.uid()`).

## 2. Verify in Dashboard (optional)

**Storage → Buckets** should list `avatars` with **Public** = off.

If the bucket insert failed, create it manually (name `avatars`, public off, 2 MB, image MIME types) and re-run the Storage policy section of `009_profile_fields.sql`.

## 3. Smoke test

1. Sign in → nav **Profile** or `/app/profile`
2. Change **Display name** → **Save profile**
3. Open Messages: your name should appear on new sends / To labels after refresh
4. Optional: **Upload photo** (under 2 MB) → preview updates; **Remove** clears it
5. Optional: set **Phone** → Save (needs migration 009)
6. Confirm Email and Household role stay read-only

No new Vercel env vars.
