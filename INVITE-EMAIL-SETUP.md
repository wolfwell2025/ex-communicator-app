# Parenting team invite email (Resend)

When you **Create invite** on Dashboard / Calendar, Ex Communicator emails the
invitee an accept link via [Resend](https://resend.com). **Copy link** remains
available if send fails or the recipient needs the URL again.

User-facing naming: **Parenting team** (not Household). No em dashes in copy.

## What gets emailed

- Inviter display name (profile display name, else email)
- Parenting team name
- Accept URL (`/app/invite/[token]`)
- Expiry date (when present)
- Short instructions: sign up or log in with **the same email** the invite was
  created for, then Accept

The API sends **only** to the email stored on the `household_invites` row. A
client cannot override the recipient.

## Env vars

| Name | Required | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | Yes (to send) | Server-only. Create in Resend → API Keys (`sending_access` is enough). |
| `RESEND_FROM_EMAIL` | No | Default: `Ex Communicator <onboarding@resend.dev>` (Resend test/onboarding domain). After you verify a domain, set e.g. `Ex Communicator <invites@yourdomain.com>`. |
| `NEXT_PUBLIC_SITE_URL` | Yes in prod | Used to build the accept link. Production: `https://ex-communicator-app.vercel.app`. |

Never expose `RESEND_API_KEY` as `NEXT_PUBLIC_*`.

## Resend setup

1. Create or sign in at [resend.com](https://resend.com).
2. **API Keys** → Create key (name e.g. `ex-communicator-invites`, permission
   `Sending access`).
3. Paste the key into:
   - Local: `.env.local` as `RESEND_API_KEY=re_...`
   - Vercel: Project → Settings → Environment Variables → Production (and
     Preview if you want invite email there) → redeploy.
4. **From address**
   - **Testing:** leave `RESEND_FROM_EMAIL` unset to use
     `Ex Communicator <onboarding@resend.dev>`. Resend typically only delivers
     test-domain mail to the address on your Resend account.
   - **Production:** Domains → Add domain → add the DNS records Resend shows
     (SPF / DKIM; optionally DMARC). Wait until status is **Verified**, then set:
     ```
     RESEND_FROM_EMAIL=Ex Communicator <invites@yourdomain.com>
     ```
5. Redeploy Vercel after changing env vars.

## Database

No migration required for this feature. Invite rows already live in
`household_invites` (migration `003_household_invites.sql`). Optional future
columns (`email_sent_at`, `email_last_error`) were skipped; send failures are
surfaced in the UI and Copy link remains available.

## API

`POST /api/invites/send` with body `{ "inviteId": "<uuid>" }`.

- Requires a signed-in parenting-team member (Supabase session cookie).
- Loads the invite under RLS; rejects non-pending / expired invites.
- Calls Resend with Idempotency-Key `invite-email-<inviteId>` so retries of the
  same invite are safer.
- On failure returns HTTP 502 with `{ emailed: false, error, acceptUrl }` so the
  UI can show Copy link.

## Smoke test

1. Set `RESEND_API_KEY` (and optionally `RESEND_FROM_EMAIL`) in `.env.local` or
   Vercel, then run / redeploy.
2. Sign in as a parenting-team member.
3. Open Dashboard or Calendar → **Invite co-parent**.
4. Enter an email you can read (with `onboarding@resend.dev`, use the email on
   your Resend account).
5. Click **Create invite**.
6. Expect success status: invite emailed. Check the inbox (and spam) for subject
   like `{Name} invited you to join {Team} on Ex Communicator`.
7. Open the Accept link while logged out → login/signup with **that same email**
   → Accept → you join the parenting team.
8. Failure path: temporarily unset `RESEND_API_KEY`, create an invite → UI shows
   a clear error and **Copy link** still works. Restore the key and use
   **Email invite** on the pending row to retry.

## Gaps / notes

- No `email_sent_at` column yet; UI does not show “last emailed at”.
- Resend onboarding domain is for testing only; verify your own domain before
  inviting real co-parents in production.
- This is invite email only (not a full transactional suite, not magic-link auth
  replacement).
