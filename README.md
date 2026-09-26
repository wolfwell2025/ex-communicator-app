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
| `/app/messages` | Messages stub |
| `/app/calendar` | Calendar stub |
| `/app/documents` | Documents stub |
| `/app/expenses` | Expenses stub |

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

## Next steps

1. Replace placeholder modules with the first product slice: messaging + transcripts, calendar, and document vault.
2. Add Postgres tables / RLS for co-parent data once Auth is confirmed in production.

## Notes

- Keep user-facing copy free of em dashes.
- Do not commit `.env` files or API keys.
