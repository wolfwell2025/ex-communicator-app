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

## Optional AI tone coaching

Tone coaching works out of the box with a built-in heuristic rewrite. To use a
real LLM for suggested rewrites, add **one** of these server-only secrets in
Vercel (Production):

| Name | Value |
| --- | --- |
| `OPENAI_API_KEY` | Your OpenAI API key (uses `gpt-4o-mini`) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (uses Claude Haiku) |

Never expose these as `NEXT_PUBLIC_*`. If neither key is set, `/api/tone-check`
still returns a solid template rewrite.


## Google Calendar + Places

See **GOOGLE-SETUP.md** for Cloud Console steps. Add these for Production
(and Preview if needed), then redeploy:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth Web client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth Web client secret |
| `CALENDAR_TOKEN_SECRET` | Long random secret for encrypting refresh/access tokens at rest |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser Maps/Places key (HTTP referrer restricted) |
| `GOOGLE_REDIRECT_URI` | Optional; default `https://ex-communicator-app.vercel.app/api/calendar/google/callback` |

**Redirect URI to allow in Google Cloud Console:**

- `https://ex-communicator-app.vercel.app/api/calendar/google/callback`
- `http://localhost:3000/api/calendar/google/callback` (local)

**Privacy:** Google sync imports events as **private** only. Co-parent never sees
them until propose + accept in-app.

Also run migration `004_calendar_oauth_tokens.sql` in Supabase SQL Editor
(multi-calendar columns + private-import trigger).
