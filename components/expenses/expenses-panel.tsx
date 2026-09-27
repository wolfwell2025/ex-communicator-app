"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_STATUS_LABELS,
  acceptExpense,
  cancelExpense,
  computeExpenseSummary,
  createExpense,
  declineExpense,
  defaultShareCents,
  deleteExpense,
  dollarsToCents,
  formatCents,
  formatIncurredOn,
  listExpenses,
  markExpensePaid,
  requestReimbursement,
  sharePercentFromCents,
  todayDateInputValue,
  updateExpenseDraft,
} from "@/lib/expenses";
import {
  listSharedDocuments,
  uploadDocument,
} from "@/lib/documents";
import type {
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  HouseholdDocument,
} from "@/lib/types";

type Props = {
  householdId: string;
  householdName: string;
  userId: string;
  memberCount: number;
  initialExpenses: Expense[];
};

type FilterStatus = "all" | "requested" | "accepted" | "paid";

type ExpenseForm = {
  title: string;
  description: string;
  category: ExpenseCategory;
  amountDollars: string;
  sharePercent: string;
  incurredOn: string;
  documentId: string;
  receiptFile: File | null;
  editingId: string | null;
};

const secondaryBtn =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50";

const primaryBtn =
  "inline-flex items-center justify-center rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

const ghostBtn =
  "inline-flex items-center justify-center rounded-xl px-2.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50";

const CATEGORY_ACCENT: Record<ExpenseCategory, string> = {
  medical: "bg-red-100 text-red-800",
  school: "bg-violet-100 text-violet-800",
  activity: "bg-blue-100 text-blue-800",
  childcare: "bg-amber-100 text-amber-900",
  clothing: "bg-pink-100 text-pink-800",
  other: "bg-slate-100 text-slate-700",
};

const STATUS_ACCENT: Record<ExpenseStatus, string> = {
  draft: "bg-surface text-muted ring-1 ring-border",
  requested: "bg-warning-soft text-warning",
  accepted: "bg-accent-soft text-accent",
  declined: "bg-danger-soft text-danger",
  paid: "bg-emerald-100 text-emerald-800",
  canceled: "bg-surface text-muted ring-1 ring-border",
};

function emptyForm(): ExpenseForm {
  return {
    title: "",
    description: "",
    category: "other",
    amountDollars: "",
    sharePercent: "50",
    incurredOn: todayDateInputValue(),
    documentId: "",
    receiptFile: null,
    editingId: null,
  };
}

function formFromExpense(e: Expense): ExpenseForm {
  return {
    title: e.title,
    description: e.description ?? "",
    category: e.category,
    amountDollars: (e.amount_cents / 100).toFixed(2),
    sharePercent: String(sharePercentFromCents(e.amount_cents, e.share_cents)),
    incurredOn: e.incurred_on,
    documentId: e.document_id ?? "",
    receiptFile: null,
    editingId: e.id,
  };
}

export function ExpensesPanel({
  householdId,
  householdName,
  userId,
  memberCount,
  initialExpenses,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [receiptDocs, setReceiptDocs] = useState<HouseholdDocument[]>([]);

  const solo = memberCount < 2;

  const refresh = useCallback(async () => {
    setLoading(true);
    const { expenses: rows, error: listError } = await listExpenses(
      supabase,
      householdId
    );
    setLoading(false);
    if (listError) {
      setError(listError);
      return;
    }
    setExpenses(rows);
    setError(null);
  }, [householdId, supabase]);

  const loadReceiptDocs = useCallback(async () => {
    const { documents } = await listSharedDocuments(supabase, householdId, {
      limit: 80,
    });
    setReceiptDocs(
      documents.filter(
        (d) => d.category === "expense" || d.category === "medical"
      )
    );
  }, [householdId, supabase]);

  useEffect(() => {
    void loadReceiptDocs();
  }, [loadReceiptDocs]);

  useEffect(() => {
    const channel = supabase
      .channel(`expenses:${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          void refresh();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, refresh, supabase]);

  const summary = useMemo(
    () => computeExpenseSummary(expenses, userId),
    [expenses, userId]
  );

  const filtered = useMemo(() => {
    if (filter === "all") {
      return expenses.filter((e) => e.status !== "canceled");
    }
    return expenses.filter((e) => e.status === filter);
  }, [expenses, filter]);

  function openCreate() {
    setForm(emptyForm());
    setFormOpen(true);
    setError(null);
    void loadReceiptDocs();
  }

  function openEdit(e: Expense) {
    if (e.requester_id !== userId || e.status !== "draft") return;
    setForm(formFromExpense(e));
    setFormOpen(true);
    setError(null);
    void loadReceiptDocs();
  }

  async function resolveDocumentId(): Promise<{
    documentId: string | null;
    error: string | null;
  }> {
    if (form.receiptFile) {
      const { document, error: upErr } = await uploadDocument(supabase, {
        householdId,
        userId,
        input: {
          title: form.title.trim()
            ? `Receipt: ${form.title.trim()}`
            : "Expense receipt",
          description: form.description.trim() || null,
          category: "expense",
          file: form.receiptFile,
          keepPrivate: false,
        },
      });
      if (upErr || !document) {
        return { documentId: null, error: upErr || "Receipt upload failed." };
      }
      return { documentId: document.id, error: null };
    }
    if (form.documentId) {
      return { documentId: form.documentId, error: null };
    }
    return { documentId: null, error: null };
  }

  function parseFormAmounts(): {
    amountCents: number;
    shareCents: number;
    error: string | null;
  } {
    const amountCents = dollarsToCents(form.amountDollars);
    if (amountCents == null) {
      return {
        amountCents: 0,
        shareCents: 0,
        error: "Enter a valid amount greater than zero.",
      };
    }
    const pct = Number(form.sharePercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return {
        amountCents,
        shareCents: 0,
        error: "Share percent must be between 0 and 100.",
      };
    }
    const shareCents = Math.min(
      amountCents,
      Math.max(0, Math.round((amountCents * pct) / 100))
    );
    return { amountCents, shareCents, error: null };
  }

  async function submitForm(
    e: FormEvent,
    asRequested: boolean
  ): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const parsed = parseFormAmounts();
    if (parsed.error) {
      setError(parsed.error);
      setBusy(false);
      return;
    }

    const { documentId, error: docErr } = await resolveDocumentId();
    if (docErr) {
      setError(docErr);
      setBusy(false);
      return;
    }

    if (form.editingId) {
      const { error: updErr } = await updateExpenseDraft(supabase, {
        expenseId: form.editingId,
        userId,
        input: {
          title: form.title,
          description: form.description,
          category: form.category,
          amount_cents: parsed.amountCents,
          share_cents: parsed.shareCents,
          incurred_on: form.incurredOn,
          document_id: documentId,
        },
      });
      if (updErr) {
        setError(updErr);
        setBusy(false);
        return;
      }
      if (asRequested) {
        const { error: reqErr } = await requestReimbursement(
          supabase,
          form.editingId,
          userId
        );
        if (reqErr) {
          setError(reqErr);
          setBusy(false);
          await refresh();
          return;
        }
      }
    } else {
      const { error: createErr } = await createExpense(supabase, {
        householdId,
        userId,
        input: {
          title: form.title,
          description: form.description,
          category: form.category,
          amount_cents: parsed.amountCents,
          share_cents: parsed.shareCents,
          incurred_on: form.incurredOn,
          document_id: documentId,
          asRequested,
        },
      });
      if (createErr) {
        setError(createErr);
        setBusy(false);
        return;
      }
    }

    setBusy(false);
    setFormOpen(false);
    setForm(emptyForm());
    await refresh();
    void loadReceiptDocs();
  }

  async function runAction(
    action: () => Promise<{ error: string | null }>
  ): Promise<void> {
    setBusy(true);
    setError(null);
    const { error: actionError } = await action();
    setBusy(false);
    if (actionError) {
      setError(actionError);
      return;
    }
    await refresh();
  }

  const amountPreviewCents = dollarsToCents(form.amountDollars);
  const sharePreviewCents =
    amountPreviewCents != null
      ? Math.min(
          amountPreviewCents,
          Math.max(
            0,
            Math.round(
              (amountPreviewCents * (Number(form.sharePercent) || 0)) / 100
            )
          )
        )
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
            Module
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            Expenses
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-muted">
            Track kids costs for {householdName}. Log what you paid, request
            reimbursement, and mark when it is paid back. No in-app payments.
          </p>
        </div>
        <button type="button" className={primaryBtn} onClick={openCreate}>
          Add expense
        </button>
      </div>

      {solo ? (
        <div className="rounded-2xl border border-amber-200 bg-warning-soft px-5 py-4 text-sm leading-6 text-amber-900">
          You are the only member of this parenting team right now. You can still log
          expenses. Invite a co-parent from the dashboard to request
          reimbursement and accept or decline requests.
        </div>
      ) : null}

      {error ? (
        <p
          className="rounded-2xl border border-red-200 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            You are owed
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {formatCents(summary.youAreOwedCents)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Requested or accepted, awaiting payment
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            You owe
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {formatCents(summary.youOweCents)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Co-parent requests waiting on you
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Paid this month
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {formatCents(summary.paidThisMonthCents)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Reimbursements marked paid
          </p>
        </div>
      </div>

      {formOpen ? (
        <form
          onSubmit={(ev) => void submitForm(ev, false)}
          className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-sm)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {form.editingId ? "Edit draft expense" : "Add expense"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                Amounts are tracked only. Settle payment outside the app, then
                mark paid.
              </p>
            </div>
            <button
              type="button"
              className={ghostBtn}
              onClick={() => {
                setFormOpen(false);
                setForm(emptyForm());
              }}
            >
              Cancel
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Title
              </span>
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="Soccer registration"
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Category
              </span>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    category: e.target.value as ExpenseCategory,
                  }))
                }
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EXPENSE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Date incurred
              </span>
              <input
                required
                type="date"
                value={form.incurredOn}
                onChange={(e) =>
                  setForm((f) => ({ ...f, incurredOn: e.target.value }))
                }
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Total amount (USD)
              </span>
              <input
                required
                inputMode="decimal"
                value={form.amountDollars}
                onChange={(e) => {
                  const next = e.target.value;
                  setForm((f) => {
                    const cents = dollarsToCents(next);
                    if (cents != null && !f.editingId && f.sharePercent === "50") {
                      // keep default 50%
                    }
                    return { ...f, amountDollars: next };
                  });
                }}
                placeholder="120.00"
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Co-parent share (%)
              </span>
              <input
                required
                inputMode="decimal"
                value={form.sharePercent}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sharePercent: e.target.value }))
                }
                placeholder="50"
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              />
              <span className="block text-xs text-muted">
                {sharePreviewCents != null
                  ? `They owe ${formatCents(sharePreviewCents)} of ${formatCents(amountPreviewCents ?? 0)} (default half is ${formatCents(defaultShareCents(amountPreviewCents ?? 0))})`
                  : "Default is 50% of the total"}
              </span>
            </label>

            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Notes (optional)
              </span>
              <textarea
                rows={2}
                maxLength={5000}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Clinic copay, receipt attached"
                className="w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Upload receipt (optional)
              </span>
              <input
                type="file"
                accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.csv,.txt"
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    receiptFile: e.target.files?.[0] ?? null,
                    documentId: e.target.files?.[0] ? "" : f.documentId,
                  }))
                }
                className="w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-accent"
              />
              <span className="block text-xs text-muted">
                Saves to Documents as category Expense, shared with parenting team.
              </span>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Or pick existing document
              </span>
              <select
                value={form.documentId}
                disabled={Boolean(form.receiptFile)}
                onChange={(e) =>
                  setForm((f) => ({ ...f, documentId: e.target.value }))
                }
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50"
              >
                <option value="">None</option>
                {receiptDocs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} ({d.category})
                  </option>
                ))}
              </select>
              {receiptDocs.length === 0 ? (
                <span className="block text-xs text-muted">
                  No shared expense or medical docs yet.{" "}
                  <Link href="/app/documents" className="font-semibold text-accent">
                    Open Documents
                  </Link>
                </span>
              ) : null}
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className={secondaryBtn}
            >
              {busy
                ? "Saving…"
                : form.editingId
                  ? "Save draft"
                  : "Save as draft"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={primaryBtn}
              onClick={(ev) => void submitForm(ev, true)}
            >
              {busy ? "Saving…" : "Request reimbursement"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "All"],
            ["requested", "Requested"],
            ["accepted", "Accepted"],
            ["paid", "Paid"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              filter === id
                ? "bg-accent text-white shadow-[var(--shadow-sm)]"
                : "border border-border bg-card text-foreground hover:border-border-strong hover:bg-surface"
            }`}
          >
            {label}
          </button>
        ))}
        {loading ? (
          <span className="text-xs text-muted">Refreshing…</span>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-[var(--shadow-sm)]">
          <p className="text-lg font-semibold text-foreground">
            {filter === "all"
              ? "No expenses yet"
              : `No ${filter} expenses`}
          </p>
          <p className="mt-2 text-base text-muted">
            {filter === "all"
              ? "Add a kids cost to start tracking reimbursement."
              : "Try another filter or add a new expense."}
          </p>
          {filter === "all" ? (
            <button
              type="button"
              className={`${primaryBtn} mt-5`}
              onClick={openCreate}
            >
              Add expense
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((exp) => {
            const mine = exp.requester_id === userId;
            const doc = exp.document_id
              ? receiptDocs.find((d) => d.id === exp.document_id)
              : null;
            return (
              <li
                key={exp.id}
                className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">
                        {exp.title}
                      </h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CATEGORY_ACCENT[exp.category]}`}
                      >
                        {EXPENSE_CATEGORY_LABELS[exp.category]}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_ACCENT[exp.status]}`}
                      >
                        {EXPENSE_STATUS_LABELS[exp.status]}
                      </span>
                    </div>
                    <p className="text-sm text-muted">
                      {formatIncurredOn(exp.incurred_on)} · Total{" "}
                      {formatCents(exp.amount_cents, exp.currency)} · Share{" "}
                      {formatCents(exp.share_cents, exp.currency)}
                      {mine ? " (they owe you)" : " (you owe)"}
                    </p>
                    {exp.description ? (
                      <p className="text-sm leading-6 text-foreground/80">
                        {exp.description}
                      </p>
                    ) : null}
                    {exp.document_id ? (
                      <p className="text-xs text-muted">
                        Receipt:{" "}
                        {doc ? (
                          <Link
                            href="/app/documents"
                            className="font-semibold text-accent"
                          >
                            {doc.title}
                          </Link>
                        ) : (
                          <Link
                            href="/app/documents"
                            className="font-semibold text-accent"
                          >
                            View in Documents
                          </Link>
                        )}
                      </p>
                    ) : null}
                    {exp.status === "paid" && exp.paid_at ? (
                      <p className="text-xs text-muted">
                        Paid{" "}
                        {new Date(exp.paid_at).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {exp.status === "draft" && mine ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          className={primaryBtn}
                          onClick={() =>
                            void runAction(async () => {
                              const { error: err } = await requestReimbursement(
                                supabase,
                                exp.id,
                                userId
                              );
                              return { error: err };
                            })
                          }
                        >
                          Request reimbursement
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className={secondaryBtn}
                          onClick={() => openEdit(exp)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className={ghostBtn}
                          onClick={() =>
                            void runAction(async () => {
                              const { error: err } = await deleteExpense(
                                supabase,
                                exp,
                                userId
                              );
                              return { error: err };
                            })
                          }
                        >
                          Delete
                        </button>
                      </>
                    ) : null}

                    {exp.status === "requested" && !mine ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          className={primaryBtn}
                          onClick={() =>
                            void runAction(async () => {
                              const { error: err } = await acceptExpense(
                                supabase,
                                exp.id,
                                userId
                              );
                              return { error: err };
                            })
                          }
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className={secondaryBtn}
                          onClick={() =>
                            void runAction(async () => {
                              const { error: err } = await declineExpense(
                                supabase,
                                exp.id,
                                userId
                              );
                              return { error: err };
                            })
                          }
                        >
                          Decline
                        </button>
                      </>
                    ) : null}

                    {exp.status === "requested" && mine ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={ghostBtn}
                        onClick={() =>
                          void runAction(async () => {
                            const { error: err } = await cancelExpense(
                              supabase,
                              exp.id,
                              userId
                            );
                            return { error: err };
                          })
                        }
                      >
                        Cancel request
                      </button>
                    ) : null}

                    {exp.status === "accepted" ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={primaryBtn}
                        onClick={() =>
                          void runAction(async () => {
                            const { error: err } = await markExpensePaid(
                              supabase,
                              exp.id,
                              userId
                            );
                            return { error: err };
                          })
                        }
                      >
                        Mark paid
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
