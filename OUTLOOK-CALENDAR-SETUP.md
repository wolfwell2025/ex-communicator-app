# Outlook / Microsoft 365 Calendar setup (Ex Communicator)

Connecting calendars **never** shares events with your co-parent. Sync imports
are always **private**. Sharing is only via in-app **Propose → Accept** with the
parenting team.

This mirrors Google Calendar connect: multi-calendar picker, Import toggle,
Export toggle (opt-in), and reconnect for write scopes.

## 1. Azure app registration

1. Open [Azure Portal → Microsoft Entra ID → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade).
2. **New registration**
   - Name: `Ex Communicator`
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (multitenant + personal), which uses tenant `common`. Or pick single-tenant and set `MICROSOFT_TENANT_ID` to that directory id.
   - Redirect URI: platform **Web**, add:
     - `https://ex-communicator-app.vercel.app/api/calendar/outlook/callback`
     - `http://localhost:3000/api/calendar/outlook/callback`
3. After create, copy **Application (client) ID**.
4. **Certificates & secrets → New client secret** → copy the **Value** (not the Secret ID). Store it as `MICROSOFT_CLIENT_SECRET`.
5. **API permissions → Add a permission → Microsoft Graph → Delegated**:
   - `User.Read`
   - `Calendars.ReadWrite` (import + export; use `Calendars.Read` only if you intentionally want import-only)
   - `offline_access` is requested in the auth URL (refresh tokens); it may not appear as a Graph permission row.
6. Click **Grant admin consent** if your org requires it (personal Microsoft accounts do not need tenant admin consent).
7. Optional: under **Authentication**, ensure both redirect URIs remain listed and **Allow public client flows** stays **No** (this is a confidential web client).

## 2. Environment variables

### Vercel (Production)

| Name | Notes |
| --- | --- |
| `MICROSOFT_CLIENT_ID` | Azure Application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | Client secret value (server-only) |
| `MICROSOFT_TENANT_ID` | Optional. Default `common` (work/school + personal). Use your directory GUID for single-tenant. |
| `MICROSOFT_REDIRECT_URI` | Optional override; default `{NEXT_PUBLIC_SITE_URL}/api/calendar/outlook/callback` |
| `CALENDAR_TOKEN_SECRET` | Long random string for AES token encryption (shared with Google; recommended) |
| `NEXT_PUBLIC_SITE_URL` | `https://ex-communicator-app.vercel.app` |

Vercel CLI (when logged in):

```bash
vercel env add MICROSOFT_CLIENT_ID production
vercel env add MICROSOFT_CLIENT_SECRET production
vercel env add CALENDAR_TOKEN_SECRET production
# optional:
# vercel env add MICROSOFT_TENANT_ID production
```

Redeploy after setting env vars.

### Local `.env.local`

```bash
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
# MICROSOFT_TENANT_ID=common
CALENDAR_TOKEN_SECRET=...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 3. Database migration

Paste and run in Supabase SQL Editor (after 002 / 004 / 007):

- `supabase/migrations/011_outlook_calendar.sql`

Provider `outlook` and source `outlook` were already allowed in migration 002.
Migration 004 already forces imported events (including outlook) to insert as
**private**. Migration 011 re-asserts that trigger and documents export for
Outlook.

## 4. How to test (smoke)

1. Sign in → **Calendar**.
2. **Connect Outlook** → Microsoft consent → pick one or more calendars with
   optional labels → **Connect selected**.
3. Confirm events appear with **Outlook** badge and stay **private**.
4. Sign in as co-parent: they must **not** see those imports.
5. As owner: **Propose** → co-parent **Accept** → then it is shared with the
   parenting team.
6. Turn **Export** on for an Outlook calendar. Create a new in-app event; it
   should appear on that Outlook calendar.
7. If Export stays disabled, use **Reconnect Outlook for two-way sync** and
   approve `Calendars.ReadWrite`.

## Privacy hard rules (product)

- Connect / sync = private to the connecting user only.
- Co-parent never sees Outlook imports until explicit propose + accept.
- Re-sync updates title/time/location only; it does **not** reset visibility if
  you already proposed or shared an event.
- Export never pushes another person's private events or re-pushes pure Outlook
  / Google imports.

## Scopes requested

```
offline_access User.Read Calendars.ReadWrite
```

Auth URL uses `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`
with Graph calendar APIs under `https://graph.microsoft.com/v1.0/`.

## Related: Outlook mail (Email intake)

Mail uses a **separate** OAuth redirect and `Mail.Read` scope. See
`EMAIL-INTAKE-SETUP.md`. Calendar reconnect does not grant mailbox access.

