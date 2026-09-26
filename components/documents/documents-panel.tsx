"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  MAX_DOCUMENT_BYTES,
  SHARED_BY_DEFAULT_CATEGORIES,
  acceptDocument,
  cancelDocumentProposal,
  declineDocument,
  deleteDocument,
  documentsForVaultList,
  formatFileSize,
  getDocumentDownloadUrl,
  incomingDocumentShareRequests,
  listDocuments,
  proposeDocument,
  unshareDocument,
  uploadDocument,
} from "@/lib/documents";
import type {
  CalendarSuggestion,
  DocumentCategory,
  HouseholdDocument,
} from "@/lib/types";
import { SuggestionBanner } from "@/components/calendar/suggestion-banner";
import { extractDateTimes } from "@/lib/date-extract";

type Props = {
  householdId: string;
  householdName: string;
  userId: string;
  initialDocuments: HouseholdDocument[];
};

const secondaryBtn =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50";

const primaryBtn =
  "inline-flex items-center justify-center rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

const ghostBtn =
  "inline-flex items-center justify-center rounded-xl px-2.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50";

const CATEGORY_ACCENT: Record<DocumentCategory, string> = {
  decree: "bg-blue-100 text-blue-800",
  school: "bg-violet-100 text-violet-800",
  medical: "bg-red-100 text-red-800",
  legal: "bg-amber-100 text-amber-900",
  expense: "bg-emerald-100 text-emerald-800",
  other: "bg-slate-100 text-slate-700",
};

type FilterCategory = DocumentCategory | "all";

type UploadForm = {
  title: string;
  description: string;
  category: DocumentCategory;
  keepPrivate: boolean;
  file: File | null;
};

function emptyUploadForm(): UploadForm {
  return {
    title: "",
    description: "",
    category: "decree",
    keepPrivate: false,
    file: null,
  };
}

function visibilityBadge(
  doc: HouseholdDocument,
  userId: string
): { label: string; className: string } {
  if (doc.visibility === "shared") {
    return { label: "Shared", className: "bg-accent-soft text-accent" };
  }
  if (doc.visibility === "pending") {
    return {
      label:
        doc.uploaded_by === userId ? "Pending accept" : "Needs your accept",
      className: "bg-warning-soft text-warning",
    };
  }
  return {
    label: "Private",
    className: "bg-surface text-muted ring-1 ring-border",
  };
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function fileKindIcon(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "IMG";
  if (mime.includes("word") || mime.includes("document")) return "DOC";
  if (mime.includes("sheet") || mime.includes("excel") || mime === "text/csv")
    return "XLS";
  return "FILE";
}

export function DocumentsPanel({
  householdId,
  householdName,
  userId,
  initialDocuments,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [documents, setDocuments] =
    useState<HouseholdDocument[]>(initialDocuments);
  const [filter, setFilter] = useState<FilterCategory>("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState<UploadForm>(emptyUploadForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [docSuggestions, setDocSuggestions] = useState<CalendarSuggestion[]>([]);
  const [docSuggestLoading, setDocSuggestLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { documents: rows, error: listError } = await listDocuments(
      supabase,
      householdId
    );
    setLoading(false);
    if (listError) {
      setError(listError);
      return;
    }
    setDocuments(rows);
    setError(null);
  }, [householdId, supabase]);

  const loadDocSuggestions = useCallback(async (documentId: string) => {
    setDocSuggestLoading(true);
    try {
      const res = await fetch("/api/calendar/suggestions/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      const json = (await res.json()) as {
        suggestions?: CalendarSuggestion[];
      };
      setDocSuggestions(json.suggestions ?? []);
    } catch {
      setDocSuggestions([]);
    }
    setDocSuggestLoading(false);
  }, []);

  function openDocDetail(doc: HouseholdDocument) {
    const next = expandedId === doc.id ? null : doc.id;
    setExpandedId(next);
    if (next) {
      const blob = `${doc.title}\n${doc.description ?? ""}`;
      const hasDates = extractDateTimes(blob).length > 0;
      if (hasDates) void loadDocSuggestions(doc.id);
      else setDocSuggestions([]);
    } else {
      setDocSuggestions([]);
    }
  }

  useEffect(() => {
    const channel = supabase
      .channel(`documents:${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
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

  const vaultDocs = useMemo(() => {
    const base = documentsForVaultList(documents, userId);
    if (filter === "all") return base;
    return base.filter((d) => d.category === filter);
  }, [documents, userId, filter]);

  const shareRequests = useMemo(
    () => incomingDocumentShareRequests(documents, userId),
    [documents, userId]
  );

  const sharedCount = documents.filter((d) => d.visibility === "shared").length;
  const privateCount = documents.filter(
    (d) => d.visibility === "private" && d.uploaded_by === userId
  ).length;

  function openUpload() {
    setForm(emptyUploadForm());
    setError(null);
    setUploadOpen(true);
  }

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (busy || !form.file) return;
    setBusy(true);
    setError(null);
    const { document: created, error: uploadError } = await uploadDocument(
      supabase,
      {
        householdId,
        userId,
        input: {
          title: form.title,
          description: form.description,
          category: form.category,
          file: form.file,
          keepPrivate: form.keepPrivate,
        },
      }
    );
    setBusy(false);
    if (uploadError || !created) {
      setError(uploadError || "Upload failed.");
      return;
    }
    setUploadOpen(false);
    setForm(emptyUploadForm());
    await refresh();
  }

  async function onDownload(doc: HouseholdDocument) {
    setBusy(true);
    setError(null);
    const { url, error: urlError } = await getDocumentDownloadUrl(
      supabase,
      doc.file_path
    );
    setBusy(false);
    if (urlError || !url) {
      setError(urlError || "Could not create download link.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function onDelete(doc: HouseholdDocument) {
    if (
      !window.confirm(
        `Delete “${doc.title}”? This removes the file from the household vault.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const { error: delError } = await deleteDocument(supabase, doc, userId);
    setBusy(false);
    if (delError) {
      setError(delError);
      return;
    }
    await refresh();
  }

  async function runAction(
    action: () => Promise<{ error: string | null }>
  ) {
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

  const defaultSharedHint = SHARED_BY_DEFAULT_CATEGORIES.includes(form.category);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-border bg-card px-5 py-5 shadow-[var(--shadow-lg)] sm:px-6">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Documents
            </h1>
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
              Vault
            </span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted">
            Household{" "}
            <span className="font-semibold text-foreground">{householdName}</span>
            <span className="mx-2 text-border-strong">·</span>
            Shared by default so both parents can reference decrees, school, and
            medical files. Keep private only when you are not ready to share.
          </p>
          <p className="text-xs text-muted">
            {sharedCount} shared
            {privateCount > 0 ? ` · ${privateCount} private (yours)` : ""}
            {shareRequests.length > 0
              ? ` · ${shareRequests.length} awaiting your accept`
              : ""}
          </p>
        </div>
        <button type="button" className={primaryBtn} onClick={openUpload}>
          Upload document
        </button>
      </div>

      {error ? (
        <p
          className="rounded-2xl border border-red-200 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {shareRequests.length > 0 ? (
        <section className="rounded-3xl border border-amber-200 bg-warning-soft/60 px-5 py-4 shadow-[var(--shadow-sm)] sm:px-6">
          <h2 className="text-base font-semibold text-foreground">
            Share requests
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Co-parent proposed these private files for the household vault.
            Accept to make them shared; decline returns them to private for the
            uploader only.
          </p>
          <ul className="mt-3 space-y-2">
            {shareRequests.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{doc.title}</p>
                  <p className="text-xs text-muted">
                    {DOCUMENT_CATEGORY_LABELS[doc.category]} · {doc.file_name} ·{" "}
                    {formatFileSize(doc.size_bytes)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={primaryBtn}
                    disabled={busy}
                    onClick={() =>
                      void runAction(async () => {
                        const r = await acceptDocument(
                          supabase,
                          doc.id,
                          userId
                        );
                        return { error: r.error };
                      })
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={busy}
                    onClick={() =>
                      void runAction(async () => {
                        const r = await declineDocument(supabase, doc.id);
                        return { error: r.error };
                      })
                    }
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    className={ghostBtn}
                    disabled={busy}
                    onClick={() => void onDownload(doc)}
                  >
                    View
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="rounded-3xl border border-border bg-card shadow-[var(--shadow-lg)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Category filter">
            <FilterChip
              active={filter === "all"}
              onClick={() => setFilter("all")}
              label="All"
            />
            {DOCUMENT_CATEGORIES.map((cat) => (
              <FilterChip
                key={cat}
                active={filter === cat}
                onClick={() => setFilter(cat)}
                label={DOCUMENT_CATEGORY_LABELS[cat]}
              />
            ))}
          </div>
          {loading ? (
            <span className="text-xs text-muted">Refreshing…</span>
          ) : null}
        </div>

        {vaultDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-2xl" aria-hidden>
              📄
            </div>
            <p className="text-lg font-semibold text-foreground">
              {filter === "all"
                ? "No documents yet"
                : `No ${DOCUMENT_CATEGORY_LABELS[filter]} documents`}
            </p>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted">
              Upload a real PDF or file (no demo placeholders). Shared uploads
              appear for both parents and in Messages → Reference document.
            </p>
            <button type="button" className={`${primaryBtn} mt-5`} onClick={openUpload}>
              Upload first document
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {vaultDocs.map((doc) => {
              const badge = visibilityBadge(doc, userId);
              const mine = doc.uploaded_by === userId;
              return (
                <li
                  key={doc.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-[10px] font-bold tracking-wide text-muted ring-1 ring-border"
                      aria-hidden
                    >
                      {fileKindIcon(doc.mime_type)}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="truncate text-left text-base font-semibold text-foreground hover:underline"
                          onClick={() => openDocDetail(doc)}
                        >
                          {doc.title}
                        </button>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_ACCENT[doc.category]}`}
                        >
                          {DOCUMENT_CATEGORY_LABELS[doc.category]}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-muted">
                        {doc.file_name} · {formatFileSize(doc.size_bytes)} ·{" "}
                        {formatWhen(doc.created_at)}
                        {mine ? " · You uploaded" : " · Co-parent uploaded"}
                      </p>
                      {doc.description ? (
                        <p className="text-sm leading-6 text-muted line-clamp-2">
                          {doc.description}
                        </p>
                      ) : null}
                      {expandedId === doc.id ? (
                        <div className="pt-2">
                          {docSuggestLoading ? (
                            <p className="text-xs text-muted">Looking for dates…</p>
                          ) : docSuggestions.length > 0 ? (
                            <SuggestionBanner
                              compact
                              title="Dates found in this document"
                              suggestions={docSuggestions}
                              onChanged={() => loadDocSuggestions(doc.id)}
                            />
                          ) : (
                            <p className="text-xs text-muted">
                              No clear upcoming dates in the title or description.
                            </p>
                          )}
                        </div>
                      ) : extractDateTimes(
                          `${doc.title}\n${doc.description ?? ""}`
                        ).length > 0 ? (
                        <button
                          type="button"
                          className="text-xs font-semibold text-accent hover:underline"
                          onClick={() => openDocDetail(doc)}
                        >
                          Dates found: review for calendar
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={busy}
                      onClick={() => void onDownload(doc)}
                    >
                      Download
                    </button>
                    {mine && doc.visibility === "private" ? (
                      <button
                        type="button"
                        className={primaryBtn}
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            const r = await proposeDocument(
                              supabase,
                              doc.id,
                              userId
                            );
                            return { error: r.error };
                          })
                        }
                      >
                        Propose share
                      </button>
                    ) : null}
                    {mine && doc.visibility === "pending" ? (
                      <button
                        type="button"
                        className={secondaryBtn}
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            const r = await cancelDocumentProposal(
                              supabase,
                              doc.id,
                              userId
                            );
                            return { error: r.error };
                          })
                        }
                      >
                        Cancel proposal
                      </button>
                    ) : null}
                    {mine && doc.visibility === "shared" ? (
                      <button
                        type="button"
                        className={secondaryBtn}
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            const r = await unshareDocument(
                              supabase,
                              doc.id,
                              userId
                            );
                            return { error: r.error };
                          })
                        }
                      >
                        Make private
                      </button>
                    ) : null}
                    {mine ? (
                      <button
                        type="button"
                        className={ghostBtn}
                        disabled={busy}
                        onClick={() => void onDelete(doc)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="px-1 text-xs leading-5 text-muted">
        Privacy: <strong className="font-semibold text-foreground">Shared</strong>{" "}
        is visible to all household members and usable in Reference document.{" "}
        <strong className="font-semibold text-foreground">Private</strong> is
        only you until you propose.{" "}
        <strong className="font-semibold text-foreground">Pending</strong> waits
        for co-parent accept (same pattern as calendar).
      </p>

      {uploadOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="doc-upload-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-foreground/40 backdrop-blur-[1px]"
            aria-label="Close upload"
            disabled={busy}
            onClick={() => setUploadOpen(false)}
          />
          <form
            onSubmit={(e) => void onUpload(e)}
            className="relative z-10 max-h-[min(92vh,720px)] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-card shadow-[var(--shadow-lg)] sm:mx-4 sm:rounded-3xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
              <div className="min-w-0">
                <h2
                  id="doc-upload-title"
                  className="text-lg font-semibold tracking-tight text-foreground"
                >
                  Upload document
                </h2>
                <p className="mt-0.5 text-xs leading-5 text-muted">
                  Defaults to shared with the household. Check private if only
                  you should see it for now.
                </p>
              </div>
              <button
                type="button"
                className={ghostBtn}
                disabled={busy}
                onClick={() => setUploadOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <label className="block space-y-1.5">
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
                  placeholder="e.g. Parenting plan decree"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
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
                      category: e.target.value as DocumentCategory,
                    }))
                  }
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                >
                  {DOCUMENT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {DOCUMENT_CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Description (optional)
                </span>
                <textarea
                  maxLength={5000}
                  rows={2}
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="Short note for the household record"
                  className="w-full resize-y rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  File
                </span>
                <input
                  required
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,image/*,text/plain,text/csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setForm((f) => ({
                      ...f,
                      file,
                      title:
                        f.title.trim() ||
                        (file ? file.name.replace(/\.[^.]+$/, "") : ""),
                    }));
                  }}
                  className="block w-full text-sm text-muted file:mr-3 file:rounded-xl file:border-0 file:bg-accent-soft file:px-3.5 file:py-2 file:text-sm file:font-semibold file:text-accent hover:file:bg-accent/15"
                />
                <span className="block text-xs text-muted">
                  PDF, images, Word, Excel, CSV, or text. Max{" "}
                  {formatFileSize(MAX_DOCUMENT_BYTES)}.
                  {form.file
                    ? ` Selected: ${form.file.name} (${formatFileSize(form.file.size)})`
                    : ""}
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-background px-3.5 py-3">
                <input
                  type="checkbox"
                  checked={form.keepPrivate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, keepPrivate: e.target.checked }))
                  }
                  className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    Keep private (only me)
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted">
                    {form.keepPrivate
                      ? "Only you can see this until you Propose share and the co-parent accepts."
                      : defaultSharedHint
                        ? "Recommended for decrees and school/medical files: both parents see it immediately."
                        : "Shared with household members as soon as you upload."}
                  </span>
                </span>
              </label>

              <div className="rounded-xl border border-border bg-surface/80 px-3.5 py-2.5 text-xs leading-5 text-muted">
                Visibility after upload:{" "}
                <span className="font-semibold text-foreground">
                  {form.keepPrivate ? "private" : "shared"}
                </span>
                {form.keepPrivate
                  ? " — co-parent cannot see or download until accepted."
                  : " — available in the vault and Messages Reference document."}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4">
              <button
                type="button"
                className={secondaryBtn}
                disabled={busy}
                onClick={() => setUploadOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={primaryBtn}
                disabled={busy || !form.file || !form.title.trim()}
              >
                {busy ? "Uploading…" : "Upload"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? "bg-accent text-white"
          : "border border-border bg-background text-foreground hover:border-accent hover:bg-accent-soft hover:text-accent"
      }`}
    >
      {label}
    </button>
  );
}
