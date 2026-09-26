# Ex Communicator

AI co-parenting MVP scaffold. Working name for an app aimed at clearer co-parent messaging, shared calendars, document vaults, and court-usable records.

Repo: [github.com/wolfwell2025/ex-communicator-app](https://github.com/wolfwell2025/ex-communicator-app)

## What is here

This is a usable Next.js App Router starter (TypeScript + Tailwind + ESLint), not a blank create-next-app page.

| Route | Purpose |
| --- | --- |
| `/` | Marketing / landing |
| `/login` | Sign-in placeholder |
| `/app` | Authenticated shell overview |
| `/app/messages` | Messages stub |
| `/app/calendar` | Calendar stub |
| `/app/documents` | Documents stub |
| `/app/expenses` | Expenses stub |

No secrets, Supabase, or Vercel deploy are included yet.

## Local development

```bash
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

## Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- ESLint

## Next steps

1. Wire Supabase (Auth + Postgres) for accounts and data.
2. Replace placeholder modules with the first product slice: messaging + transcripts, calendar, and document vault.
3. Deploy to Vercel and connect environment variables there (never commit secrets).

## Notes

- Keep user-facing copy free of em dashes.
- Do not commit `.env` files or API keys.
