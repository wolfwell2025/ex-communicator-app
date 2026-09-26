# Documents vault setup

## 1. Run the SQL migration

Supabase Dashboard → **SQL Editor** → paste and **Run**:

[`supabase/migrations/005_documents.sql`](supabase/migrations/005_documents.sql)

This creates:

- Table `public.documents` with RLS (`private` | `pending` | `shared`)
- Storage bucket `documents` (private, 25 MiB, PDF/image/Office/text MIME allowlist)
- Storage RLS on `storage.objects` for that bucket

Path convention: `{household_id}/{user_id}/{uuid}-{file_name}`

## 2. Verify in Dashboard (optional)

**Storage → Buckets** should list `documents` with **Public** = off.

If the bucket insert failed (rare permission edge case), create it manually:

1. Storage → New bucket → name `documents` → Public: **off** → file size limit 25MB
2. Re-run only the Storage policy section of `005_documents.sql`, or re-run the whole file (idempotent `on conflict` / `drop policy if exists`)

## 3. Smoke test

1. Sign in → `/app/documents`
2. Upload a PDF (category Decree). Leave “Keep private” unchecked → should show **Shared**
3. Open Messages → **Reference document** → the file should appear
4. Upload another with **Keep private** → only you see it; **Propose share** → co-parent gets Share requests → Accept → shared

No fake demo files are seeded.
