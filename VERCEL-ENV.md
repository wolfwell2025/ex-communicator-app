# Vercel environment variables

Paste these into the Vercel project **Settings → Environment Variables** for
Production (and Preview if you want auth there too).

Do **not** commit `.env.local`. Only the public URL + publishable key go in Vercel
for this MVP. Do not invent or paste a `service_role` key unless you need admin APIs.

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://ex-communicator-app.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://pryvielnxaxylcxihgpk.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable__JMOlCmSnK7yCYnbuWVFpg_oyISbnKi` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable__JMOlCmSnK7yCYnbuWVFpg_oyISbnKi` |

`NEXT_PUBLIC_SITE_URL` is the canonical origin used for auth email redirects
(`emailRedirectTo`). Without it, confirmation/magic links can fall back to
Supabase Site URL (often still `http://localhost:3000`).

The ANON var is an alias of the publishable key so any code/docs that still
expect `ANON` keep working. Same value in both places.

## Supabase Auth URL config

In the Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL:** `https://ex-communicator-app.vercel.app`
- **Redirect URLs** (add all that apply):
  - `https://ex-communicator-app.vercel.app/auth/callback`
  - `https://ex-communicator-app.vercel.app/auth/confirm`
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3000/auth/confirm`
