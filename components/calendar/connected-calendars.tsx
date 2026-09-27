"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connectionHasWriteScope } from "@/lib/google-calendar-scopes";
import type { PersonalCalendarConnection } from "@/lib/types";

const secondaryBtn =
  "inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50";

const primaryBtn =
  "inline-flex items-center justify-center rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

type GoogleCalOption = {
  id: string;
  summary: string;
  primary?: boolean;
  alreadyConnected?: boolean;
};

type Props = {
  connections: PersonalCalendarConnection[];
  onChanged: () => Promise<void> | void;
  autoOpenPicker?: boolean;
  googleUpgraded?: boolean;
  flashError?: string | null;
  oauthConfiguredHint?: boolean;
};

const LABEL_COLORS = [
  "#1d4ed8",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#db2777",
  "#0891b2",
  "#4f46e5",
  "#ca8a04",
];

function colorForLabel(label: string | null, id: string): string {
  const seed = (label || id || "cal").toLowerCase();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

function inferKind(label: string | null, calendarId: string | null): string {
  const s = `${label ?? ""} ${calendarId ?? ""}`.toLowerCase();
  if (/\b(work|office|job|corp)\b/.test(s)) return "Work";
  if (/\b(family|kids|children|shared|household)\b/.test(s)) return "Family";
  if (/\b(personal|me|home|primary)\b/.test(s)) return "Personal";
  if (label && label.trim()) return "Custom";
  return "Google";
}

function formatRelativeSync(iso: string | null): string {
  if (!iso) return "Not synced yet";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Not synced yet";
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "Synced just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `Synced ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Synced ${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `Synced ${day}d ago`;
  return `Synced ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function ConnectedCalendars({
  connections,
  onChanged,
  autoOpenPicker,
  googleUpgraded = false,
  flashError,
  oauthConfiguredHint = true,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(flashError ?? null);
  const [note, setNote] = useState<string | null>(
    googleUpgraded
      ? "Google write access updated. You can turn Export on."
      : null
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fromConnection, setFromConnection] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [options, setOptions] = useState<GoogleCalOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [privacyNote, setPrivacyNote] = useState<string | null>(null);
  const autoOpened = useRef(false);

  const googleConnections = connections.filter(
    (c) => c.provider === "google" && c.status === "connected"
  );

  const needsWriteReconnect = googleConnections.some(
    (c) => !connectionHasWriteScope(c.scopes)
  );

  const loadPicker = useCallback(async (reuseConnectionId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const qs = reuseConnectionId
        ? `?fromConnection=${encodeURIComponent(reuseConnectionId)}`
        : "";
      const res = await fetch(`/api/calendar/google/calendars${qs}`);
      const json = (await res.json()) as {
        email?: string;
        calendars?: GoogleCalOption[];
        privacyNote?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || "Could not list Google calendars.");
        setBusy(false);
        return;
      }
      setEmail(json.email ?? null);
      setOptions(json.calendars ?? []);
      setPrivacyNote(json.privacyNote ?? null);
      const initial: Record<string, string> = {};
      for (const c of json.calendars ?? []) {
        // Pre-check already-connected and primary so reconnect can refresh tokens/scopes
        if (c.alreadyConnected || c.primary) {
          initial[c.id] = c.summary;
        }
      }
      setSelected(initial);
      setFromConnection(reuseConnectionId ?? null);
      setPickerOpen(true);
    } catch {
      setError("Could not list Google calendars.");
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!autoOpenPicker || autoOpened.current) return;
    autoOpened.current = true;
    const t = window.setTimeout(() => {
      void loadPicker();
    }, 0);
    return () => window.clearTimeout(t);
  }, [autoOpenPicker, loadPicker]);

  async function saveSelection() {
    const calendars = Object.entries(selected).map(([id, label]) => {
      const opt = options.find((o) => o.id === id);
      return { id, summary: opt?.summary || label, label };
    });
    if (calendars.length === 0) {
      setError("Select at least one calendar to connect.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/google/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendars,
          fromConnection: fromConnection || undefined,
          syncNow: true,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        errors?: string[];
        privacyNote?: string;
      };
      if (!res.ok) {
        setError(json.error || "Failed to save calendars.");
        setBusy(false);
        return;
      }
      setPickerOpen(false);
      setNote(
        json.privacyNote ||
          "Calendars connected. Imported events stay private until you propose them."
      );
      if (json.errors?.length) {
        setError(json.errors.join(" · "));
      }
      await onChanged();
    } catch {
      setError("Failed to save calendars.");
    }
    setBusy(false);
  }

  async function toggleSync(connectionId: string, syncEnabled: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/calendar/google/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, syncEnabled }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) setError(json.error || "Could not update sync.");
    setBusy(false);
    await onChanged();
  }

  async function toggleExport(connectionId: string, exportEnabled: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/calendar/google/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, exportEnabled }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) setError(json.error || "Could not update export.");
    else if (exportEnabled) {
      setNote(
        "Export on. New events you create in Ex Communicator will be pushed to this Google calendar. Co-parent private events are never exported."
      );
    }
    setBusy(false);
    await onChanged();
  }

  async function syncOne(connectionId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/calendar/google/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId }),
    });
    const json = (await res.json()) as {
      error?: string;
      imported?: number;
      privacyNote?: string;
    };
    if (!res.ok) {
      setError(json.error || "Sync failed.");
    } else {
      setNote(
        `Synced ${json.imported ?? 0} events. ${json.privacyNote ?? "They stay private until you propose."}`
      );
    }
    setBusy(false);
    await onChanged();
  }

  async function removeOne(connectionId: string) {
    if (
      !window.confirm(
        "Disconnect this calendar? Imported private events will be kept unless you choose to remove them next."
      )
    ) {
      return;
    }
    const removeImported = window.confirm(
      "Also delete events previously imported from this calendar? (Only your private Google imports.)"
    );
    setBusy(true);
    setError(null);
    const res = await fetch("/api/calendar/google/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId,
        removeImportedEvents: removeImported,
      }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) setError(json.error || "Disconnect failed.");
    setBusy(false);
    await onChanged();
  }

  function toggleOption(cal: GoogleCalOption) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[cal.id] !== undefined) {
        delete next[cal.id];
      } else {
        next[cal.id] = cal.summary;
      }
      return next;
    });
  }

  return (
    <section
      id="connected-calendars"
      className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground sm:text-base">
            Connected calendars
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
            Personal, work, or family Google calendars.{" "}
            <span className="font-semibold text-foreground">
              Import never shares with your co-parent.
            </span>{" "}
            Imports stay private until you propose and they accept. Export to
            Google is opt-in per calendar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {googleConnections.length > 0 ? (
            <button
              type="button"
              className={secondaryBtn}
              disabled={busy}
              onClick={() => void loadPicker(googleConnections[0].id)}
            >
              Add another
            </button>
          ) : null}
          <a
            href="/api/calendar/google/connect"
            className={primaryBtn}
            aria-disabled={busy}
          >
            {googleConnections.length > 0 ? "Connect Google again" : "Connect Google Calendar"}
          </a>
        </div>
      </div>

      {error ? (
        <p
          className="mt-3 rounded-xl border border-red-200 bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
          role="alert"
        >
          {error}
          {error.includes("not_configured") || flashError === "not_configured" ? (
            <span className="mt-1 block text-xs text-muted">
              Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in Vercel and create
              OAuth credentials (see GOOGLE-SETUP.md).
            </span>
          ) : null}
        </p>
      ) : null}

      {note ? (
        <p className="mt-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-muted">
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

      {!oauthConfiguredHint ? (
        <p className="mt-3 text-xs text-muted">
          Google OAuth env vars are not set yet. UI is ready; finish setup in
          GOOGLE-SETUP.md.
        </p>
      ) : null}

      {needsWriteReconnect ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-warning-soft/70 px-3.5 py-3 text-sm text-foreground">
          <p className="font-semibold">Reconnect Google for two-way sync</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Your connection only has read access. Disconnect is not required:
            use Connect Google again (or Connect Google again below) and approve
            calendar write access so Export can push events you create.
          </p>
          <a href="/api/calendar/google/connect" className={`${primaryBtn} mt-2`}>
            Reconnect Google for two-way sync
          </a>
        </div>
      ) : null}

      {googleConnections.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-6 text-center">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-card ring-1 ring-border"
            aria-hidden
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-muted">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 9h18M8 3v4M16 3v4" />
            </svg>
          </div>
          <p className="text-sm font-medium text-foreground">No calendars connected</p>
          <p className="max-w-sm text-xs leading-5 text-muted">
            Connect Google, then pick personal, work, or shared family calendars.
            Everything imports as private.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {googleConnections.map((c) => {
            const color = colorForLabel(c.label, c.id);
            const kind = inferKind(c.label, c.external_calendar_id);
            const displayName =
              c.label?.trim() ||
              c.external_calendar_id ||
              "Google calendar";
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-3 sm:px-3.5"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-[var(--shadow-sm)]"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  >
                    {(displayName.slice(0, 1) || "G").toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-semibold text-foreground">
                        {displayName}
                      </p>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-border">
                        {kind}
                      </span>
                      {!c.sync_enabled ? (
                        <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning">
                          Import paused
                        </span>
                      ) : null}
                      {c.export_enabled ? (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                          Export on
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {c.external_account_email || "Google"}
                      {c.external_calendar_id && c.label
                        ? ` · ${c.external_calendar_id}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {formatRelativeSync(c.last_synced_at)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <label
                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground"
                    title={c.sync_enabled ? "Import enabled" : "Import paused"}
                  >
                    <span
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        c.sync_enabled ? "bg-accent" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          c.sync_enabled ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={c.sync_enabled}
                        disabled={busy}
                        onChange={(e) => void toggleSync(c.id, e.target.checked)}
                      />
                    </span>
                    Import
                  </label>
                  <label
                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground"
                    title={
                      !connectionHasWriteScope(c.scopes)
                        ? "Reconnect Google for two-way sync"
                        : c.export_enabled
                          ? "Export enabled"
                          : "Export off (opt-in)"
                    }
                  >
                    <span
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        c.export_enabled ? "bg-accent" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          c.export_enabled ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={Boolean(c.export_enabled)}
                        disabled={busy || !connectionHasWriteScope(c.scopes)}
                        onChange={(e) => void toggleExport(c.id, e.target.checked)}
                      />
                    </span>
                    Export
                  </label>
                  {!connectionHasWriteScope(c.scopes) ? (
                    <a
                      href="/api/calendar/google/connect"
                      className="text-[11px] font-semibold text-warning hover:underline"
                    >
                      Reconnect for export
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={busy || !c.sync_enabled}
                    onClick={() => void syncOne(c.id)}
                  >
                    Sync now
                  </button>
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={busy}
                    onClick={() => void removeOne(c.id)}
                  >
                    Disconnect
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pickerOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="google-cal-picker-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-foreground/40 backdrop-blur-[1px]"
            aria-label="Close picker"
            disabled={busy}
            onClick={() => setPickerOpen(false)}
          />
          <div className="relative z-10 max-h-[min(92vh,640px)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-card shadow-[var(--shadow-lg)] sm:mx-4 sm:rounded-2xl">
            <div className="sticky top-0 border-b border-border bg-card/95 px-4 py-3.5 backdrop-blur sm:px-5">
              <h3
                id="google-cal-picker-title"
                className="text-lg font-semibold tracking-tight text-foreground sm:text-xl"
              >
                Choose calendars to sync
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted">
                {email ? `Account: ${email}. ` : ""}
                {privacyNote ||
                  "Selected calendars import as private only. Nothing is shared until you propose an event in-app."}
              </p>
            </div>

            <ul className="space-y-2 px-4 py-4 sm:px-5">
              {options.map((cal) => {
                const checked = selected[cal.id] !== undefined;
                return (
                  <li
                    key={cal.id}
                    className={`rounded-xl border px-3.5 py-3 ${
                      checked
                        ? "border-accent bg-accent-soft/40"
                        : "border-border bg-background"
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={busy}
                        checked={checked}
                        onChange={() => toggleOption(cal)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-foreground">
                          {cal.summary}
                          {cal.primary ? (
                            <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase text-accent">
                              Primary
                            </span>
                          ) : null}
                          {cal.alreadyConnected ? (
                            <span className="ml-2 text-[10px] font-semibold uppercase text-muted">
                              Already connected
                            </span>
                          ) : null}
                        </span>
                        {checked ? (
                          <div className="mt-2 space-y-1">
                            <span className="text-[11px] font-medium text-muted">
                              Label (personal / work / family)
                            </span>
                            <input
                              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
                              value={selected[cal.id]}
                              disabled={busy}
                              onChange={(e) =>
                                setSelected((prev) => ({
                                  ...prev,
                                  [cal.id]: e.target.value,
                                }))
                              }
                              placeholder="e.g. Work, Kids, Personal"
                              maxLength={120}
                            />
                          </div>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {options.length === 0 ? (
              <p className="px-4 pb-2 text-sm text-muted sm:px-5">
                No calendars returned from Google.
              </p>
            ) : null}

            <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-5">
              <button
                type="button"
                className={secondaryBtn}
                disabled={busy}
                onClick={() => setPickerOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={primaryBtn}
                disabled={busy || Object.keys(selected).length === 0}
                onClick={() => void saveSelection()}
              >
                {busy ? "Saving…" : "Connect selected"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
