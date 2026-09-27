import type { SupabaseClient } from "@supabase/supabase-js";
import type { Expense, ExpenseCategory, ExpenseStatus } from "./types";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  medical: "Medical",
  school: "School",
  activity: "Activity",
  childcare: "Childcare",
  clothing: "Clothing",
  other: "Other",
};

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "medical",
  "school",
  "activity",
  "childcare",
  "clothing",
  "other",
];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  draft: "Draft",
  requested: "Requested",
  accepted: "Accepted",
  declined: "Declined",
  paid: "Paid",
  canceled: "Canceled",
};

const SELECT_COLS =
  "id, household_id, title, description, category, amount_cents, currency, incurred_on, requester_id, share_cents, status, document_id, requested_at, responded_at, responded_by, paid_at, paid_noted_by, created_at, updated_at";

export function dollarsToCents(dollars: string | number): number | null {
  const raw =
    typeof dollars === "number" ? dollars : Number(String(dollars).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 100);
}

export function formatCents(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

export function defaultShareCents(amountCents: number): number {
  return Math.round(amountCents / 2);
}

export function sharePercentFromCents(
  amountCents: number,
  shareCents: number
): number {
  if (amountCents <= 0) return 50;
  return Math.round((shareCents / amountCents) * 1000) / 10;
}

export async function listExpenses(
  supabase: SupabaseClient,
  householdId: string,
  options?: { status?: ExpenseStatus | "all" }
): Promise<{ expenses: Expense[]; error: string | null }> {
  let query = supabase
    .from("expenses")
    .select(SELECT_COLS)
    .eq("household_id", householdId)
    .order("incurred_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (options?.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) {
    return { expenses: [], error: error.message };
  }
  return { expenses: (data ?? []) as Expense[], error: null };
}

/** Requested / accepted / paid expenses for Reference picker (not drafts/canceled/declined). */
export async function listReferenceableExpenses(
  supabase: SupabaseClient,
  householdId: string,
  options?: { limit?: number }
): Promise<{ expenses: Expense[]; error: string | null }> {
  let query = supabase
    .from("expenses")
    .select(SELECT_COLS)
    .eq("household_id", householdId)
    .in("status", ["requested", "accepted", "paid"])
    .order("incurred_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) {
    return { expenses: [], error: error.message };
  }
  return { expenses: (data ?? []) as Expense[], error: null };
}

export type CreateExpenseInput = {
  title: string;
  description?: string | null;
  category: ExpenseCategory;
  amount_cents: number;
  share_cents: number;
  incurred_on: string;
  document_id?: string | null;
  /** Create as requested immediately (sets requested_at). Default draft. */
  asRequested?: boolean;
};

export async function createExpense(
  supabase: SupabaseClient,
  args: {
    householdId: string;
    userId: string;
    input: CreateExpenseInput;
  }
): Promise<{ expense: Expense | null; error: string | null }> {
  const title = args.input.title.trim();
  if (!title) {
    return { expense: null, error: "Title is required." };
  }
  if (!args.input.amount_cents || args.input.amount_cents <= 0) {
    return { expense: null, error: "Amount must be greater than zero." };
  }
  if (
    args.input.share_cents < 0 ||
    args.input.share_cents > args.input.amount_cents
  ) {
    return {
      expense: null,
      error: "Share owed must be between $0 and the total amount.",
    };
  }
  if (!args.input.incurred_on?.trim()) {
    return { expense: null, error: "Date is required." };
  }

  const asRequested = Boolean(args.input.asRequested);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      household_id: args.householdId,
      requester_id: args.userId,
      title,
      description: args.input.description?.trim() || null,
      category: args.input.category,
      amount_cents: args.input.amount_cents,
      share_cents: args.input.share_cents,
      incurred_on: args.input.incurred_on.trim(),
      document_id: args.input.document_id ?? null,
      status: asRequested ? "requested" : "draft",
      requested_at: asRequested ? now : null,
      currency: "USD",
    })
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { expense: null, error: error.message };
  }
  return { expense: data as Expense, error: null };
}

export type UpdateExpenseDraftInput = {
  title: string;
  description?: string | null;
  category: ExpenseCategory;
  amount_cents: number;
  share_cents: number;
  incurred_on: string;
  document_id?: string | null;
};

export async function updateExpenseDraft(
  supabase: SupabaseClient,
  args: {
    expenseId: string;
    userId: string;
    input: UpdateExpenseDraftInput;
  }
): Promise<{ expense: Expense | null; error: string | null }> {
  const title = args.input.title.trim();
  if (!title) {
    return { expense: null, error: "Title is required." };
  }
  if (!args.input.amount_cents || args.input.amount_cents <= 0) {
    return { expense: null, error: "Amount must be greater than zero." };
  }
  if (
    args.input.share_cents < 0 ||
    args.input.share_cents > args.input.amount_cents
  ) {
    return {
      expense: null,
      error: "Share owed must be between $0 and the total amount.",
    };
  }

  const { data, error } = await supabase
    .from("expenses")
    .update({
      title,
      description: args.input.description?.trim() || null,
      category: args.input.category,
      amount_cents: args.input.amount_cents,
      share_cents: args.input.share_cents,
      incurred_on: args.input.incurred_on.trim(),
      document_id: args.input.document_id ?? null,
    })
    .eq("id", args.expenseId)
    .eq("requester_id", args.userId)
    .eq("status", "draft")
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { expense: null, error: error.message };
  }
  return { expense: data as Expense, error: null };
}

export async function requestReimbursement(
  supabase: SupabaseClient,
  expenseId: string,
  userId: string
): Promise<{ expense: Expense | null; error: string | null }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("expenses")
    .update({
      status: "requested",
      requested_at: now,
    })
    .eq("id", expenseId)
    .eq("requester_id", userId)
    .eq("status", "draft")
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { expense: null, error: error.message };
  }
  return { expense: data as Expense, error: null };
}

export async function cancelExpense(
  supabase: SupabaseClient,
  expenseId: string,
  userId: string
): Promise<{ expense: Expense | null; error: string | null }> {
  const { data, error } = await supabase
    .from("expenses")
    .update({ status: "canceled" })
    .eq("id", expenseId)
    .eq("requester_id", userId)
    .in("status", ["draft", "requested"])
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { expense: null, error: error.message };
  }
  return { expense: data as Expense, error: null };
}

export async function deleteExpense(
  supabase: SupabaseClient,
  expense: Expense,
  userId: string
): Promise<{ error: string | null }> {
  if (expense.requester_id !== userId) {
    return { error: "Only the creator can delete this expense." };
  }
  if (expense.status !== "draft" && expense.status !== "canceled") {
    return {
      error: "Only draft or canceled expenses can be deleted. Cancel first.",
    };
  }
  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expense.id)
    .eq("requester_id", userId);
  if (error) {
    return { error: error.message };
  }
  return { error: null };
}

export async function acceptExpense(
  supabase: SupabaseClient,
  expenseId: string,
  userId: string
): Promise<{ expense: Expense | null; error: string | null }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("expenses")
    .update({
      status: "accepted",
      responded_at: now,
      responded_by: userId,
    })
    .eq("id", expenseId)
    .eq("status", "requested")
    .neq("requester_id", userId)
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { expense: null, error: error.message };
  }
  return { expense: data as Expense, error: null };
}

export async function declineExpense(
  supabase: SupabaseClient,
  expenseId: string,
  userId: string
): Promise<{ expense: Expense | null; error: string | null }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("expenses")
    .update({
      status: "declined",
      responded_at: now,
      responded_by: userId,
    })
    .eq("id", expenseId)
    .eq("status", "requested")
    .neq("requester_id", userId)
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { expense: null, error: error.message };
  }
  return { expense: data as Expense, error: null };
}

export async function markExpensePaid(
  supabase: SupabaseClient,
  expenseId: string,
  userId: string
): Promise<{ expense: Expense | null; error: string | null }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("expenses")
    .update({
      status: "paid",
      paid_at: now,
      paid_noted_by: userId,
    })
    .eq("id", expenseId)
    .eq("status", "accepted")
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { expense: null, error: error.message };
  }
  return { expense: data as Expense, error: null };
}

export type ExpenseSummary = {
  youAreOwedCents: number;
  youOweCents: number;
  paidThisMonthCents: number;
};

/** Compute summary cards from the viewer's perspective. */
export function computeExpenseSummary(
  expenses: Expense[],
  userId: string,
  now = new Date()
): ExpenseSummary {
  const month = now.getMonth();
  const year = now.getFullYear();
  let youAreOwedCents = 0;
  let youOweCents = 0;
  let paidThisMonthCents = 0;

  for (const e of expenses) {
    const open = e.status === "requested" || e.status === "accepted";
    if (open && e.requester_id === userId) {
      youAreOwedCents += e.share_cents;
    } else if (open && e.requester_id !== userId) {
      youOweCents += e.share_cents;
    }
    if (e.status === "paid" && e.paid_at) {
      const d = new Date(e.paid_at);
      if (d.getMonth() === month && d.getFullYear() === year) {
        paidThisMonthCents += e.share_cents;
      }
    }
  }

  return { youAreOwedCents, youOweCents, paidThisMonthCents };
}

/** Map expenses to reference-picker / tone-context shape. */
export function expensesToPickerItems(expenses: Expense[]) {
  return expenses.map((e) => ({
    id: e.id,
    title: e.title,
    categoryLabel: EXPENSE_CATEGORY_LABELS[e.category] ?? e.category,
    statusLabel: EXPENSE_STATUS_LABELS[e.status] ?? e.status,
    amountLabel: formatCents(e.amount_cents, e.currency),
    shareLabel: formatCents(e.share_cents, e.currency),
    incurredOn: formatIncurredOn(e.incurred_on),
    status: e.status,
  }));
}

export function formatIncurredOn(dateStr: string): string {
  try {
    // incurred_on is a date (YYYY-MM-DD); parse as local noon to avoid TZ shift
    const [y, m, d] = dateStr.split("-").map(Number);
    if (!y || !m || !d) return dateStr;
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    return dt.toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return dateStr;
  }
}

export function todayDateInputValue(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
