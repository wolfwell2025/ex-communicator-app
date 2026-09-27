"use client";

import { useCallback, useState } from "react";
import {
  formatSuggestionWhen,
} from "@/lib/calendar-suggestions";
import type { CalendarSuggestion } from "@/lib/types";

const secondaryBtn =
  "inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50";

const primaryBtn =
  "inline-flex items-center justify-center rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

const ghostBtn =
  "inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50";

type Props = {
  suggestions: CalendarSuggestion[];
  onChanged: () => void | Promise<void>;
  /** Compact chips style for document detail */
  compact?: boolean;
  title?: string;
};

export function SuggestionBanner({
  suggestions,
  onChanged,
  compact = false,
  title = "Add to calendar?",
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const act = useCallback(
    async (
      suggestionId: string,
      action: "accept" | "dismiss",
      visibility?: "private" | "pending"
    ) => {
      setBusyId(suggestionId);
      setError(null);
      try {
        const res = await fetch("/api/calendar/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suggestionId, action, visibility }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(json.error || "Could not update suggestion.");
        } else if (action === "accept") {
          setNote(
            visibility === "pending"
              ? "Proposed to parenting team. Co-parent must accept before it is shared."
              : "Added as a private event."
          );
        }
        await onChanged();
      } catch {
        setError("Could not update suggestion.");
      }
      setBusyId(null);
    },
    [onChanged]
  );

  if (suggestions.length === 0) return null;

  return (
    <section
      className={
        compact
          ? "rounded-xl border border-accent/30 bg-accent-soft/40 px-3 py-3"
          : "rounded-2xl border border-accent/40 bg-accent-soft/50 px-4 py-3.5 shadow-[var(--shadow-sm)] sm:px-5"
      }
      aria-label="Calendar suggestions"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted">
            A date was confirmed in this conversation or document. Choose
            private, propose to share, or dismiss.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="mt-2 text-xs text-muted">
          {note}{" "}
          <button
            type="button"
            className="font-semibold text-accent hover:underline"
            onClick={() => setNote(null)}
          >
            Dismiss
          </button>
        </p>
      ) : null}

      <ul className={`mt-3 space-y-2 ${compact ? "" : ""}`}>
        {suggestions.map((s) => {
          const busy = busyId === s.id;
          return (
            <li
              key={s.id}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{s.title}</p>
                <p className="text-xs text-muted">
                  {formatSuggestionWhen(s)}
                  {s.all_day ? " · All day" : ""}
                  {s.source_type === "document" ? " · From document" : " · From messages"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={busy}
                  onClick={() => void act(s.id, "accept", "private")}
                >
                  Add private
                </button>
                <button
                  type="button"
                  className={secondaryBtn}
                  disabled={busy}
                  onClick={() => void act(s.id, "accept", "pending")}
                >
                  Propose to share
                </button>
                <button
                  type="button"
                  className={ghostBtn}
                  disabled={busy}
                  onClick={() => void act(s.id, "dismiss")}
                >
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Lightweight document date chips before they are persisted as suggestions. */
export function DocumentDateChips(props: {
  dates: Array<{ label: string; when: string; onPrivate: () => void; onShare: () => void; onDismiss: () => void }>;
  busy?: boolean;
}) {
  if (props.dates.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-border bg-surface/80 px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Dates found in this document
      </p>
      <ul className="mt-2 space-y-2">
        {props.dates.map((d, i) => (
          <li
            key={`${d.when}-${i}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {d.label}
              </p>
              <p className="text-xs text-muted">{d.when}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={primaryBtn}
                disabled={props.busy}
                onClick={d.onPrivate}
              >
                Add private
              </button>
              <button
                type="button"
                className={secondaryBtn}
                disabled={props.busy}
                onClick={d.onShare}
              >
                Propose
              </button>
              <button
                type="button"
                className={ghostBtn}
                disabled={props.busy}
                onClick={d.onDismiss}
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
