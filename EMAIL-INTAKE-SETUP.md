# Email intake setup (Gmail + Outlook mail)

Connect personal mail so parents can **see relevant threads in-app** and
**draft a parenting-team message** grounded in that email. Imported mailbox
content is **always private** to the connecting user (same spirit as calendar
private-until-propose).

This MVP does **not** send external email as the user. Outbound SMTP / Graph
send is out of scope.

Naming: **Parenting team** (not Household). No em dashes in user-facing copy.

## Privacy hard rules

- Connect / sync = private to the connecting user only (RLS `user_id = auth.uid()`).
- Co-parent never sees `email_threads` / `email_messages`.
- **Draft message from email** / **Share to parenting team** only opens Messages
  with draft text the user can edit. Raw mailbox content is not auto-shared.
- Nothing is auto-sent externally.

## Important: separate from Calendar OAuth

| Surface | Google scopes | Microsoft scopes | Redirect |
| --- | --- | --- | --- |
| Calendar | `calendar` | `Calendars.ReadWrite` | `/api/calendar/.../callback` |
| Email intake | `gmail.readonly` | `Mail.Read` | `/api/email/.../callback` |

Connecting Calendar does **not** grant mail. Connecting Email does **not** grant
calendar. Users reconnect each surface separately. Same Cloud/Azure app IDs are
fine; add the extra redirect URIs and API scopes.

Mail tokens reuse `CALENDAR_TOKEN_SECRET` (AES-GCM via `lib/crypto-tokens.ts`).

## 1. Database migration

Paste and run in Supabase SQL Editor (after 001):

- `supabase/migrations/012_email_intake.sql`

Creates `email_connections`, `email_threads`, `email_messages` with owner-only RLS.

## 2. Google (Gmail)

Uses the same OAuth Web client as Calendar (`GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET`).

1. [Google Cloud Console](https://console.cloud.google.com/) → enable **Gmail API**.
2. OAuth consent screen → add scope:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - (keep existing calendar / userinfo scopes)
3. While app is in **Testing**, add your Google account as a test user.
4. Credentials → your Web client → **Authorized redirect URIs**, add:
   - `https://ex-communicator-app.vercel.app/api/email/gmail/callback`
   - `http://localhost:3000/api/email/gmail/callback`
5. Keep existing calendar redirect URIs.

### Env (Gmail)

| Name | Notes |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Same as Calendar |
| `GOOGLE_CLIENT_SECRET` | Same as Calendar |
| `CALENDAR_TOKEN_SECRET` | Shared AES secret for stored tokens |
| `GMAIL_REDIRECT_URI` | Optional; default `{NEXT_PUBLIC_SITE_URL}/api/email/gmail/callback` |
| `NEXT_PUBLIC_SITE_URL` | Production or `http://localhost:3000` |

## 3. Microsoft (Outlook mail)

Uses the same Azure app as Calendar (`MICROSOFT_CLIENT_ID` /
`MICROSOFT_CLIENT_SECRET`).

1. Azure Portal → App registration → **Authentication** → Web redirect URIs, add:
   - `https://ex-communicator-app.vercel.app/api/email/outlook/callback`
   - `http://localhost:3000/api/email/outlook/callback`
2. **API permissions → Microsoft Graph → Delegated**, add:
   - `Mail.Read` (intake only; do not require Mail.ReadWrite for this MVP)
   - Keep existing `User.Read` and calendar permissions
3. Grant admin consent if your org requires it (personal Microsoft accounts usually do not).
4. If you previously connected only Calendar, users must use **Connect Outlook**
   on `/app/email` (separate consent for `Mail.Read`). Calendar reconnect alone
   does not unlock mail.

### Env (Outlook mail)

| Name | Notes |
| --- | --- |
| `MICROSOFT_CLIENT_ID` | Same as Calendar |
| `MICROSOFT_CLIENT_SECRET` | Same as Calendar |
| `MICROSOFT_TENANT_ID` | Optional; default `common` |
| `MICROSOFT_MAIL_REDIRECT_URI` | Optional; default `{NEXT_PUBLIC_SITE_URL}/api/email/outlook/callback` |
| `CALENDAR_TOKEN_SECRET` | Shared AES secret |

Do **not** point `MICROSOFT_REDIRECT_URI` (calendar) at the mail callback.

## 4. Vercel

Add any missing vars, then redeploy. See `VERCEL-ENV.md`.

```bash
# usually already set from Calendar:
# vercel env add GOOGLE_CLIENT_ID production
# vercel env add GOOGLE_CLIENT_SECRET production
# vercel env add MICROSOFT_CLIENT_ID production
# vercel env add MICROSOFT_CLIENT_SECRET production
# vercel env add CALENDAR_TOKEN_SECRET production
```

## 5. Smoke tests

1. Sign in → **Email**.
2. **Connect Gmail** → consent `gmail.readonly` → land on `/app/email?gmail_connected=1`.
3. Confirm threads list; open a thread (read-only). Sign in as co-parent: they
   must **not** see those threads.
4. **Draft message from email** → Messages opens with subject/body prefilled.
   Edit and send (or discard). Co-parent only sees what you send in Messages.
5. **Connect Outlook** on Email → consent `Mail.Read` → sync → same privacy checks.
6. Calendar page still works with existing Google/Outlook calendar connections
   without requiring mail reconnect.

## Scopes requested

Gmail:

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/userinfo.email
```

Outlook mail:

```
offline_access User.Read Mail.Read
```

## Out of scope (this pass)

- Sending external email / SMTP / Graph send as the user
- OFW history import
- Calling
- Changing Outlook calendar product behavior (mail scopes are a separate connect)
