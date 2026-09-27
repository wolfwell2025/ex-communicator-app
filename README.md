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
| `/app/email` | Private Gmail / Outlook mail intake + draft into Messages |
| `/app/calendar` | Shared custody calendar (private / propose / accept) + Google / Outlook import/export |
| `/app/documents` | Parenting team document vault (upload / share / reference) |
| `/app/expenses` | Shared kids expenses + reimbursement workflow |
| `/app/invite/[token]` | Accept co-parent parenting team invite |
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

Parenting team invite email (Resend; server-only — see `INVITE-EMAIL-SETUP.md`):

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (optional; defaults to `Ex Communicator <onboarding@resend.dev>`)

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
6. [`supabase/migrations/006_message_threads.sql`](supabase/migrations/006_message_threads.sql) — message threads (subjects, recipients, search). Migrates existing flat messages into a legacy thread (DB subject may still say Household messages).
7. [`supabase/migrations/007_calendar_suggestions_and_export.sql`](supabase/migrations/007_calendar_suggestions_and_export.sql) — `calendar_suggestions` (message/doc date prompts) + `export_enabled` on connections. After OAuth scope upgrade, use **Reconnect Google/Outlook for two-way sync** if Export stays disabled.
8. [`supabase/migrations/011_outlook_calendar.sql`](supabase/migrations/011_outlook_calendar.sql) — Outlook / Microsoft 365 calendar (re-asserts private-import trigger; documents export).
8. [`supabase/migrations/008_expenses.sql`](supabase/migrations/008_expenses.sql) — `expenses` table with reimbursement statuses (`draft` / `requested` / `accepted` / `declined` / `paid` / `canceled`) and optional receipt `document_id`. See `EXPENSES-SETUP.md`.
9. [`supabase/migrations/009_profile_fields.sql`](supabase/migrations/009_profile_fields.sql) — profile `phone` + `avatar_path` and private Storage bucket `avatars`. See `PROFILE-SETUP.md`.
10. [`supabase/migrations/010_parenting_team_roles.sql`](supabase/migrations/010_parenting_team_roles.sql) — expand membership roles; user-facing Parenting team naming (DB tables stay `households`). See `PARENTING-TEAM.md`.
11. [`supabase/migrations/011_outlook_calendar.sql`](supabase/migrations/011_outlook_calendar.sql) — Outlook calendar private-import / export docs (if not already applied).
12. [`supabase/migrations/012_email_intake.sql`](supabase/migrations/012_email_intake.sql) — Gmail / Outlook mail connections + private threads/messages. See `EMAIL-INTAKE-SETUP.md`.

Confirm tables exist, then sign in and open `/app`, `/app/calendar`, `/app/messages`, `/app/email`, `/app/documents`, `/app/expenses`, and `/app/profile`.

### Email privacy

- Imported Gmail / Outlook threads are **private** to the connecting user (RLS owner-only).
- Co-parent never sees mailbox content in Email.
- **Draft message from email** opens Messages with editable draft text only. Nothing auto-sends externally.
- Mail OAuth is separate from Calendar OAuth (extra redirect URIs + `gmail.readonly` / `Mail.Read`). See `EMAIL-INTAKE-SETUP.md`.

### Calendar privacy

- **private** — only the creator can see the event (co-parent sees nothing).
- **pending** - proposed to parenting team; appears in Share requests for the co-parent, not on the shared month grid until accepted.
- **shared** - visible to all parenting team members; Reference calendar chip uses shared events only.
- **Google / Outlook sync** — connect multiple calendars (personal / work / family). Imports are **always private**. Export is opt-in per calendar (`export_enabled`). Connecting never auto-shares. Share only via Propose → Accept. See `GOOGLE-SETUP.md` and `OUTLOOK-CALENDAR-SETUP.md`.

### Documents privacy

- **shared** (default) - visible to all parenting team members; Reference document chip uses shared docs only. Best for decrees, school, and medical files both parents need.
- **private** — only the uploader (optional checkbox at upload). Co-parent sees nothing until Propose → Accept.
- **pending** - proposed to parenting team; appears in Documents Share requests for the co-parent.
- **Storage** — private bucket `documents`; paths `{household_id}/{user_id}/…`; download via short-lived signed URLs. Migration 005 creates the bucket + Storage RLS.

### Expenses

- Log kids costs (medical, school, activity, childcare, clothing, other).
- Request reimbursement: co-parent Accept / Decline; either parent can Mark paid after settling outside the app.
- Optional receipt: upload into Documents (`category = expense`, shared) or link an existing shared expense/medical document.
- Reference expense chip in Messages uses requested / accepted / paid rows only.
- See [`EXPENSES-SETUP.md`](EXPENSES-SETUP.md).

### Profile

- `/app/profile` (nav **Profile**): edit display name, optional phone and photo.
- Email is read-only. Parenting team name and membership role are editable on Profile (roles: parent, caregiver, legal, kid, grandparent, family_member). See `PARENTING-TEAM.md` and migration `010`.
- Display name feeds message To labels and sender names after save/refresh.
- See [`PROFILE-SETUP.md`](PROFILE-SETUP.md).

### Invite co-parent

On Dashboard or Calendar, use **Invite co-parent**: enter their email → the app emails them an accept link (Resend; see `INVITE-EMAIL-SETUP.md`) → they sign up/log in with that **same email** → open `/app/invite/[token]` → Accept. They join your parenting team. **Copy link** remains available if email send fails or they need the URL again.

## Google Calendar + Places

Follow [`GOOGLE-SETUP.md`](GOOGLE-SETUP.md) for OAuth credentials, Maps key, env vars, and redirect URIs.

## Outlook / Microsoft 365 Calendar

Follow [`OUTLOOK-CALENDAR-SETUP.md`](OUTLOOK-CALENDAR-SETUP.md) for Azure app registration, Graph scopes (`Calendars.ReadWrite`), env vars, and redirect URIs.

### Messaging threads

- **Subject** — each conversation has an OFW-style subject line.
- **To** - multi-select parenting team members (or Parenting team for everyone). Solo teams default to Parenting team until a co-parent is invited.
- **Search** — filters the thread list by subject, participants, and last-message preview.
- Tone coaching, Reference pickers, Download transcript, and Print/PDF still work on the open thread.

## Next steps

1. Finish Google Cloud OAuth + Places keys; run migration 004; connect multiple calendars.
2. Run migration 005; upload a decree PDF; confirm Reference document in Messages.
3. Run migration 006 for threaded subjects / recipients / search.
4. Run migration 008; add an expense and exercise Accept / Mark paid with a co-parent.

## Notes

- Keep user-facing copy free of em dashes.
- Do not commit `.env` files or API keys.
