# Expenses setup

## 1. Run the SQL migration

Supabase Dashboard → **SQL Editor** → paste and **Run**:

[`supabase/migrations/008_expenses.sql`](supabase/migrations/008_expenses.sql)

Requires migrations `001` (households) and ideally `005` (documents) if you attach receipts.

This creates:

- Table `public.expenses` with RLS (household members can read; creator inserts; members update for accept/decline/paid)
- Statuses: `draft` → `requested` → `accepted` | `declined` → `paid` (or `canceled`)
- Optional `document_id` FK to a shared Documents receipt (`category = expense`)

## 2. Smoke test

1. Sign in → `/app/expenses`
2. **Add expense** → title, category, amount, date, co-parent share (default 50%) → **Request reimbursement**
3. Optional: upload a receipt (creates a shared Documents row) or pick an existing expense/medical document
4. As the co-parent: Accept or Decline the requested expense
5. Either parent: **Mark paid** after money moves outside the app
6. Open Messages → **Reference expense** → pick a requested/accepted/paid expense → generate a calm message

Solo households can log expenses; invite a co-parent from the dashboard before reimbursement requests make sense.

No Stripe or in-app payments for MVP. No new Vercel env vars.
