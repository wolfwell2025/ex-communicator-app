# Ex Communicator

AI co-parenting MVP scaffold. Working name for an app aimed at clearer co-parent messaging, shared calendars, document vaults, and court-usable records.

Repo: [github.com/wolfwell2025/ex-communicator-app](https://github.com/wolfwell2025/ex-communicator-app)

## What is here

Next.js App Router starter (TypeScript + Tailwind + ESLint) with Supabase Auth wired for email password and magic-link sign-in.

| Route | Purpose |
| --- | --- |
| `/` | Marketing / landing |
| `/login` | Email password or magic-link sign-in |
| `/auth/callback` | OAuth / PKCE code exchange |
| `/auth/confirm` | Email OTP / magic-link confirmation |
| `/app` | Authenticated shell (requires session) |
| `/app/messages` | Threaded messaging (subject, To, search) + transcript export |
| `/app/calendar` | Shared custody calendar (private / propose / accept) |
| `/app/documents` | Household document vault (upload / share / reference) |
| `/app/expenses` | Expenses stub |
| `/app/invite/[token]` | Accept co-parent household invite |
| `/app/messages/export` | Print-friendly transcript (watermarked) |

## Local development

```bash
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other scripts:

```bash
npm run build   # production build
npm run start   # serve production build
npm run lint    # ESLint
```

## Environment variables

See `.env.local.example` and `VERCEL-ENV.md`.

Public (safe for the browser / Vercel):

- `NEXT_PUBLIC_SITE_URL` (canonical origin for auth email redirects; set to `https://ex-communicator-app.vercel.app` in production)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional alias; same value as publishable)

Server-only placeholder (do not invent or commit a real value):

- `SUPABASE_SERVICE_ROLE_KEY`

Never commit `.env.local` or real secrets. `.env*` is gitignored except the `*.example` templates.

## Supabase Auth URL configuration

In the Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL:** `https://ex-communicator-app.vercel.app`
- **Redirect URLs:**
  - `https://ex-communicator-app.vercel.app/auth/callback`
  - `https://ex-communicator-app.vercel.app/auth/confirm`
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3000/auth/confirm`

After setting Vercel env vars (see `VERCEL-ENV.md`), redeploy so Auth can complete.

## Stack

- Next.js 16 (App Router) + Proxy for session refresh
- TypeScript
- Tailwind CSS
- ESLint
- Supabase (`@supabase/supabase-js`, `@supabase/ssr`)

## Database migrations

Open Supabase Dashboard → **SQL Editor** for project `pryvielnxaxylcxihgpk`. If the Supabase CLI is not linked, paste each file and Run (in order):

1. [`supabase/migrations/001_households_messages.sql`](supabase/migrations/001_households_messages.sql) — profiles, households, messages, RLS helpers.
2. [`supabase/migrations/002_calendar_events.sql`](supabase/migrations/002_calendar_events.sql) — `calendar_events` + `personal_calendar_connections`, privacy RLS (`private` / `pending` / `shared`).
3. [`supabase/migrations/003_household_invites.sql`](supabase/migrations/003_household_invites.sql) — co-parent email invites (`create_household_invite` / `accept_household_invite`).
4. [`supabase/migrations/004_calendar_oauth_tokens.sql`](supabase/migrations/004_calendar_oauth_tokens.sql) — multi-calendar OAuth columns + imported-events-must-insert-private trigger.
5. [`supabase/migrations/005_documents.sql`](supabase/migrations/005_documents.sql) — `documents` table + private Storage bucket `documents` with RLS.
6. [`supabase/migrations/006_message_threads.sql`](supabase/migrations/006_message_threads.sql) — message threads (subjects, recipients, search). Migrates existing flat messages into a legacy "Household messages" thread.

Confirm tables exist, then sign in and open `/app`, `/app/calendar`, `/app/messages`, and `/app/documents`.

### Calendar privacy

- **private** — only the creator can see the event (co-parent sees nothing).
- **pending** — proposed to household; appears in Share requests for the co-parent, not on the shared month grid until accepted.
- **shared** — visible to all household members; Reference calendar chip uses shared events only.
- **Google sync** — connect multiple calendars (personal / work / family). Imports are **always private**. Connecting never auto-shares. Share only via Propose → Accept. See `GOOGLE-SETUP.md`.

### Documents privacy

- **shared** (default) — visible to all household members; Reference document chip uses shared docs only. Best for decrees, school, and medical files both parents need.
- **private** — only the uploader (optional checkbox at upload). Co-parent sees nothing until Propose → Accept.
- **pending** — proposed to household; appears in Documents Share requests for the co-parent.
- **Storage** — private bucket `documents`; paths `{household_id}/{user_id}/…`; download via short-lived signed URLs. Migration 005 creates the bucket + Storage RLS.

### Invite co-parent

On Dashboard or Calendar, use **Invite co-parent**: enter their email → Copy link → they sign up/log in with that **same email** → open `/app/invite/[token]` → Accept. They join your household.

## Google Calendar + Places

Follow [`GOOGLE-SETUP.md`](GOOGLE-SETUP.md) for OAuth credentials, Maps key, env vars, and redirect URIs.

### Messaging threads

- **Subject** — each conversation has an OFW-style subject line.
- **To** — multi-select household members (or Household for everyone). Solo households default to Household until a co-parent is invited.
- **Search** — filters the thread list by subject, participants, and last-message preview.
- Tone coaching, Reference pickers, Download transcript, and Print/PDF still work on the open thread.

## Next steps

1. Finish Google Cloud OAuth + Places keys; run migration 004; connect multiple calendars.
2. Run migration 005; upload a decree PDF; confirm Reference document in Messages.
3. Run migration 006 for threaded subjects / recipients / search.
4. Expenses module.

## Notes

- Keep user-facing copy free of em dashes.
- Do not commit `.env` files or API keys.
