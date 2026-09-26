# Google Calendar + Places setup (Ex Communicator)

Connecting calendars **never** shares events with your co-parent. Sync imports
are always **private**. Sharing is only via in-app **Propose → Accept**.

## 1. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project (e.g. `ex-communicator`).
3. Enable APIs:
   - **Google Calendar API**
   - **Places API** (or Places API New) — for location autocomplete
   - **Maps JavaScript API** — required for Places Autocomplete in the browser

## 2. OAuth 2.0 client (Calendar connect)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `Ex Communicator`
4. **Authorized redirect URIs** (add all you use):
   - `https://ex-communicator-app.vercel.app/api/calendar/google/callback`
   - `http://localhost:3000/api/calendar/google/callback`
5. Copy **Client ID** and **Client secret**.
6. OAuth consent screen:
   - User type: External (or Internal if Workspace-only)
   - App name: Ex Communicator
   - Scopes: `calendar.readonly`, `userinfo.email` (openid/email profile as offered)
   - Add your Google account as a test user while the app is in Testing

## 3. Maps / Places browser key

1. **Credentials → Create credentials → API key**
2. Restrict the key:
   - Application restrictions: HTTP referrers
     - `https://ex-communicator-app.vercel.app/*`
     - `http://localhost:3000/*`
   - API restrictions: Maps JavaScript API + Places API
3. This value is public in the browser (`NEXT_PUBLIC_…`). Restrictions matter.

## 4. Environment variables

### Vercel (Production)

| Name | Notes |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth Web client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth Web client secret (server-only) |
| `CALENDAR_TOKEN_SECRET` | Long random string for AES token encryption (recommended; falls back to client secret) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser Maps/Places key |
| `GOOGLE_REDIRECT_URI` | Optional override; default is `{NEXT_PUBLIC_SITE_URL}/api/calendar/google/callback` |
| `NEXT_PUBLIC_SITE_URL` | `https://ex-communicator-app.vercel.app` |

Vercel CLI (when logged in):

```bash
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel env add CALENDAR_TOKEN_SECRET production
vercel env add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY production
```

Redeploy after setting env vars.

### Local `.env.local`

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
CALENDAR_TOKEN_SECRET=...
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 5. Database migration

Paste and run in Supabase SQL Editor:

- `supabase/migrations/004_calendar_oauth_tokens.sql`

This adds multi-calendar columns (`label`, `sync_enabled`, encrypted tokens) and a
trigger so **imported** events always **insert as private**.

## 6. How to test

1. Sign in → **Calendar**.
2. **Connect Google Calendar** → Google consent → pick one or more calendars
   (personal / work / family) with optional labels → **Connect selected**.
3. Confirm events appear with **Google · private until proposed**.
4. Sign in as co-parent: they must **not** see those events.
5. As owner: **Propose to household** → co-parent **Accept** → then it is shared.
6. **Add another calendar** reuses the same Google account; **Connect Google again**
   can authorize a different account.
7. Type in **Location** on New event: autocomplete if Maps key is set; otherwise plain text.

## Privacy hard rules (product)

- Connect / sync = private to the connecting user only.
- Co-parent never sees Google imports until explicit propose + accept.
- Re-sync updates title/time/location only; it does **not** reset visibility if
  you already proposed or shared an event.
