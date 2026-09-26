"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PersonalCalendarConnection } from "@/lib/types";

const secondaryBtn =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50";

const primaryBtn =
  "inline-flex items-center justify-center rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

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
  flashError?: string | null;
  oauthConfiguredHint?: boolean;
};

export function ConnectedCalendars({
  connections,
  onChanged,
  autoOpenPicker,
  flashError,
  oauthConfiguredHint = true,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(flashError ?? null);
  const [note, setNote] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fromConnection, setFromConnection] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [options, setOptions] = useState<GoogleCalOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({}); // id -> label
  const [privacyNote, setPrivacyNote] = useState<string | null>(null);
  const autoOpened = useRef(false);

  const googleConnections = connections.filter(
    (c) => c.provider === "google" && c.status === "connected"
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
        if (!c.alreadyConnected && c.primary) {
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
    // Defer so OAuth return does not setState synchronously in the effect body.
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
    if (cal.alreadyConnected) return;
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
    <section id="connected-calendars" className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Connected calendars
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
            Connect personal, family, or work Google calendars.{" "}
            <span className="font-semibold text-foreground">
              Sync never shares events with your co-parent.
            </span>{" "}
            Imports stay private until you propose an event and they accept
            in-app.
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
              Add another calendar
            </button>
          ) : null}
          <a
            href="/api/calendar/google/connect"
            className={primaryBtn}
            aria-disabled={busy}
          >
            {googleConnections.length > 0
              ? "Connect Google again"
              : "Connect Google Calendar"}
          </a>
        </div>
      </div>

      {error ? (
        <p
          className="mt-3 rounded-2xl border border-red-200 bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
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
        <p className="mt-3 rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm text-muted">
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

      {googleConnections.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No calendars connected. Connect Google, then pick personal, work, or
          shared family calendars to sync privately.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {googleConnections.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {c.label || c.external_calendar_id || "Google calendar"}
                </p>
                <p className="text-xs text-muted">
                  {c.external_account_email || "Google"}
                  {c.external_calendar_id
                    ? ` · ${c.external_calendar_id}`
                    : ""}
                  {c.last_synced_at
                    ? ` · Synced ${new Date(c.last_synced_at).toLocaleString()}`
                    : " · Not synced yet"}
                  {c.sync_enabled ? "" : " · Sync paused"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <label className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground">
                  <input
                    type="checkbox"
                    checked={c.sync_enabled}
                    disabled={busy}
                    onChange={(e) =>
                      void toggleSync(c.id, e.target.checked)
                    }
                  />
                  Sync on
                </label>
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
          ))}
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
          <div className="relative z-10 max-h-[min(92vh,640px)] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-[var(--shadow-lg)] sm:mx-4 sm:rounded-3xl sm:p-6">
            <h3
              id="google-cal-picker-title"
              className="text-xl font-semibold tracking-tight text-foreground"
            >
              Choose calendars to sync
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              {email ? `Account: ${email}. ` : ""}
              {privacyNote ||
                "Selected calendars import as private only. Nothing is shared with your co-parent until you propose an event in-app."}
            </p>

            <ul className="mt-4 space-y-2">
              {options.map((cal) => {
                const checked = selected[cal.id] !== undefined;
                return (
                  <li
                    key={cal.id}
                    className={`rounded-2xl border px-3.5 py-3 ${
                      cal.alreadyConnected
                        ? "border-border bg-surface opacity-70"
                        : checked
                          ? "border-accent bg-accent-soft/40"
                          : "border-border bg-background"
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={busy || cal.alreadyConnected}
                        checked={checked || Boolean(cal.alreadyConnected)}
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
                        {checked && !cal.alreadyConnected ? (
                          <input
                            className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
                            value={selected[cal.id]}
                            disabled={busy}
                            onChange={(e) =>
                              setSelected((prev) => ({
                                ...prev,
                                [cal.id]: e.target.value,
                              }))
                            }
                            placeholder="Label (e.g. Work, Kids, Personal)"
                            maxLength={120}
                          />
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {options.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No calendars returned from Google.
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
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
