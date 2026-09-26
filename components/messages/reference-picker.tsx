"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  factsFromRecord,
  type FactLine,
  type ReferenceKind,
  type SelectedReferenceRecord,
} from "@/lib/reference-generate";
import type { ContextMessage } from "@/lib/household-context";

export type PickerCalendarItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
};

export type PickerDocumentItem = {
  id: string;
  title: string;
  kindLabel?: string | null;
  updatedAt?: string | null;
  amount?: string | number | null;
  snippet?: string | null;
};

export type PickerCallItem = {
  id: string;
  summary: string;
  occurredAt: string;
  durationMinutes?: number | null;
};

type Props = {
  kind: ReferenceKind;
  open: boolean;
  onClose: () => void;
  /** Called when a calm message was generated from a real selection. */
  onGenerated: (suggestion: string, facts: FactLine[]) => void;
  messages: ContextMessage[];
  calendarEvents?: PickerCalendarItem[];
  documents?: PickerDocumentItem[];
  callLogs?: PickerCallItem[];
};

const KIND_META: Record<
  ReferenceKind,
  {
    title: string;
    emptyTitle: string;
    emptyBody: string;
    addHref?: string;
    addLabel?: string;
  }
> = {
  message: {
    title: "Reference a message",
    emptyTitle: "No messages in this thread yet",
    emptyBody:
      "Send or receive a message first. We only generate from real thread content — nothing is invented.",
  },
  calendar: {
    title: "Reference a calendar event",
    emptyTitle: "No calendar events yet",
    emptyBody:
      "Calendar is coming soon. Add a real event when the module is live — we will not invent fake events.",
    addHref: "/app/calendar",
    addLabel: "Open Calendar",
  },
  document: {
    title: "Reference a document",
    emptyTitle: "No shared documents yet",
    emptyBody:
      "Documents vault is coming soon. Add a real file when available — we will not invent fake documents.",
    addHref: "/app/documents",
    addLabel: "Open Documents",
  },
  call: {
    title: "Reference a call",
    emptyTitle: "No call logs yet",
    emptyBody:
      "Call logging is coming soon. We will not invent a fake call summary.",
  },
};

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

function clip(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

type Row = {
  key: string;
  title: string;
  subtitle: string;
  record: SelectedReferenceRecord;
};

export function ReferencePicker({
  kind,
  open,
  onClose,
  onGenerated,
  messages,
  calendarEvents = [],
  documents = [],
  callLogs = [],
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = KIND_META[kind];

  const rows: Row[] = useMemo(() => {
    switch (kind) {
      case "message":
        return [...messages]
          .slice()
          .reverse()
          .map((m) => ({
            key: m.id,
            title: `${m.senderLabel}${m.mine ? " (you)" : ""}`,
            subtitle: `${formatWhen(m.createdAt)} · ${clip(m.body, 100)}`,
            record: {
              kind: "message" as const,
              id: m.id,
              senderLabel: m.senderLabel,
              body: m.body,
              createdAt: m.createdAt,
              mine: m.mine,
            },
          }));
      case "calendar":
        return calendarEvents.map((e) => ({
          key: e.id,
          title: e.title || "Untitled event",
          subtitle: [
            e.startsAt ? formatWhen(e.startsAt) : null,
            e.location?.trim() || null,
          ]
            .filter(Boolean)
            .join(" · "),
          record: {
            kind: "calendar" as const,
            id: e.id,
            title: e.title,
            startsAt: e.startsAt,
            endsAt: e.endsAt ?? null,
            location: e.location ?? null,
          },
        }));
      case "document":
        return documents.map((d) => ({
          key: d.id,
          title: d.title || "Untitled document",
          subtitle: [
            d.kindLabel || null,
            d.amount != null && String(d.amount).trim() !== ""
              ? `Amount ${d.amount}`
              : null,
            d.updatedAt ? `Updated ${formatWhen(d.updatedAt)}` : null,
            d.snippet ? clip(d.snippet, 80) : null,
          ]
            .filter(Boolean)
            .join(" · "),
          record: {
            kind: "document" as const,
            id: d.id,
            title: d.title,
            kindLabel: d.kindLabel ?? null,
            updatedAt: d.updatedAt ?? null,
            amount: d.amount ?? null,
            snippet: d.snippet ?? null,
          },
        }));
      case "call":
        return callLogs.map((c) => ({
          key: c.id,
          title: c.occurredAt
            ? `Call · ${formatWhen(c.occurredAt)}`
            : "Call log",
          subtitle: clip(c.summary || "No summary", 120),
          record: {
            kind: "call" as const,
            id: c.id,
            summary: c.summary,
            occurredAt: c.occurredAt,
            durationMinutes: c.durationMinutes ?? null,
          },
        }));
      default:
        return [];
    }
  }, [kind, messages, calendarEvents, documents, callLogs]);

  const selected = rows.find((r) => r.key === selectedKey) ?? null;
  const confirmFacts = selected ? factsFromRecord(selected.record) : [];

  useEffect(() => {
    if (!open) return;
    setSelectedKey(null);
    setStep("pick");
    setGenerating(false);
    setError(null);
  }, [open, kind]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !generating) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, generating, onClose]);

  if (!open) return null;

  async function generate() {
    if (!selected || confirmFacts.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/reference-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: selected.record.kind,
          record: selected.record,
        }),
      });
      const data = (await res.json()) as {
        suggestion?: string;
        facts?: FactLine[];
        error?: string;
      };
      if (!res.ok || !data.suggestion) {
        setError(
          data.error ||
            "Could not generate from this record. No facts were invented."
        );
        return;
      }
      onGenerated(data.suggestion, data.facts ?? confirmFacts);
      onClose();
    } catch {
      setError("Network error while generating. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reference-picker-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-foreground/40 backdrop-blur-[1px]"
        aria-label="Close picker"
        disabled={generating}
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(88vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-[var(--shadow-lg)] sm:mx-4 sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2
              id="reference-picker-title"
              className="text-lg font-semibold tracking-tight text-foreground"
            >
              {meta.title}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              {step === "pick"
                ? "Pick a real item. We only cite fields on that record — never invented details."
                : "Confirm the facts below. Generation uses only these fields."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            className="rounded-xl border border-border bg-background px-2.5 py-1.5 text-sm font-semibold text-muted hover:bg-surface"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {step === "pick" ? (
            rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-background px-5 py-10 text-center">
                <p className="text-base font-semibold text-foreground">
                  {meta.emptyTitle}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {meta.emptyBody}
                </p>
                {meta.addHref && meta.addLabel ? (
                  <Link
                    href={meta.addHref}
                    className="mt-4 inline-flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] hover:border-accent hover:bg-accent-soft hover:text-accent"
                    onClick={onClose}
                  >
                    {meta.addLabel}
                  </Link>
                ) : null}
              </div>
            ) : (
              <ul className="space-y-2" role="listbox" aria-label={meta.title}>
                {rows.map((row) => {
                  const active = selectedKey === row.key;
                  return (
                    <li key={row.key}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => setSelectedKey(row.key)}
                        className={`w-full rounded-2xl border px-3.5 py-3 text-left transition-colors ${
                          active
                            ? "border-accent bg-accent-soft"
                            : "border-border bg-background hover:border-border-strong hover:bg-surface"
                        }`}
                      >
                        <span className="block text-sm font-semibold text-foreground">
                          {row.title}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted">
                          {row.subtitle || "No extra details"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-border bg-background px-4 py-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Facts that will be used
                </p>
                {confirmFacts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">
                    This record has no usable fields. Choose another item — we
                    will not fabricate details.
                  </p>
                ) : (
                  <dl className="mt-2.5 space-y-2">
                    {confirmFacts.map((f) => (
                      <div key={f.label}>
                        <dt className="text-[11px] font-semibold text-muted">
                          {f.label}
                        </dt>
                        <dd className="text-sm leading-6 text-foreground whitespace-pre-wrap">
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              {error ? (
                <p
                  className="rounded-xl border border-red-200 bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3.5 sm:px-5">
          {step === "confirm" ? (
            <button
              type="button"
              disabled={generating}
              onClick={() => {
                setStep("pick");
                setError(null);
              }}
              className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] hover:bg-surface"
            >
              Back
            </button>
          ) : (
            <span className="text-xs text-muted">
              {rows.length > 0
                ? `${rows.length} item${rows.length === 1 ? "" : "s"}`
                : "Empty — no fake demos"}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            {step === "pick" ? (
              <button
                type="button"
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  setStep("confirm");
                  setError(null);
                }}
                className="rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-[var(--shadow-sm)] hover:bg-accent-hover disabled:opacity-50"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                disabled={generating || confirmFacts.length === 0}
                onClick={() => void generate()}
                className="rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-[var(--shadow-sm)] hover:bg-accent-hover disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate message"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
