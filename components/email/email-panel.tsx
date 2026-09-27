"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type {
  EmailConnection,
  EmailMessage,
  EmailThreadListItem,
} from "@/lib/types";

type Props = {
  userId: string;
  initialConnections: EmailConnection[];
  initialThreads: EmailThreadListItem[];
  needsMigration: boolean;
  gmailConfigured: boolean;
  outlookConfigured: boolean;
  flash?: {
    gmailConnected?: boolean;
    outlookConnected?: boolean;
    gmailError?: string | null;
    outlookError?: string | null;
  };
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function clip(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function providerLabel(p: string): string {
  return p === "gmail" ? "Gmail" : "Outlook";
}

const secondaryBtn =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50";

const primaryBtn =
  "inline-flex items-center justify-center rounded-xl bg-accent px-3.5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

export function EmailPanel({
  initialConnections,
  initialThreads,
  needsMigration: initialNeedsMigration,
  gmailConfigured,
  outlookConfigured,
  flash,
}: Props) {
  const [connections, setConnections] =
    useState<EmailConnection[]>(initialConnections);
  const [threads, setThreads] =
    useState<EmailThreadListItem[]>(initialThreads);
  const [needsMigration] = useState(initialNeedsMigration);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialThreads[0]?.id ?? null
  );
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(() => {
    if (flash?.gmailConnected) return "Gmail connected. Recent threads synced privately.";
    if (flash?.outlookConnected)
      return "Outlook mail connected. Recent threads synced privately.";
    return null;
  });
  const [search, setSearch] = useState("");

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => {
      const hay = [
        t.subject,
        t.snippet,
        t.account_email,
        ...(t.participants ?? []).map((p) => `${p.name ?? ""} ${p.email}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [threads, search]);

  const loadThread = useCallback(async (threadId: string) => {
    setSelectedId(threadId);
    setMessagesLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/email/threads?id=${encodeURIComponent(threadId)}`
      );
      const json = (await res.json()) as {
        messages?: EmailMessage[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Could not load thread");
      setMessages(json.messages ?? []);
    } catch (e) {
      setMessages([]);
      setError(e instanceof Error ? e.message : "Could not load thread");
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const refreshList = useCallback(async () => {
    const res = await fetch("/api/email/threads");
    const json = (await res.json()) as {
      threads?: EmailThreadListItem[];
      error?: string;
    };
    if (res.ok && json.threads) {
      setThreads(json.threads);
    }
  }, []);

  async function syncAll() {
    setSyncing(true);
    setError(null);
    setStatus(null);
    try {
      const results = await Promise.all([
        fetch("/api/email/gmail/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
        fetch("/api/email/outlook/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      ]);
      let imported = 0;
      const errs: string[] = [];
      for (const res of results) {
        const json = (await res.json()) as {
          imported?: number;
          error?: string;
          errors?: string[];
        };
        imported += json.imported ?? 0;
        if (json.error) errs.push(json.error);
        if (json.errors?.length) errs.push(...json.errors);
      }
      await refreshList();
      // Refresh connections via soft reload of connection status from threads is enough;
      // keep existing connection list unless user reconnects.
      setStatus(
        `Synced ${imported} message${imported === 1 ? "" : "s"}. Email stays private until you draft into Messages.`
      );
      if (errs.length) {
        setError(errs.slice(0, 2).join(" · "));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect(connectionId: string, provider: string) {
    const path =
      provider === "gmail"
        ? "/api/email/gmail/disconnect"
        : "/api/email/outlook/disconnect";
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, removeImported: true }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Disconnect failed");
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
      setThreads((prev) =>
        prev.filter((t) => t.connection_id !== connectionId)
      );
      if (selected?.connection_id === connectionId) {
        setSelectedId(null);
        setMessages([]);
      }
      setStatus(`${providerLabel(provider)} disconnected. Imported mail removed.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    }
  }

  async function draftFromEmail() {
    if (!selected) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch("/api/email/draft-from", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: selected.id }),
      });
      const json = (await res.json()) as {
        messagesPath?: string;
        error?: string;
      };
      if (!res.ok || !json.messagesPath) {
        throw new Error(json.error || "Could not build draft");
      }
      window.location.href = json.messagesPath;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft failed");
      setDrafting(false);
    }
  }

  if (needsMigration) {
    return (
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Email
        </h1>
        <p className="rounded-2xl border border-amber-200 bg-warning-soft p-5 text-sm text-amber-900">
          Email intake needs a database migration. Paste{" "}
          <code className="rounded-md border border-amber-200 bg-white px-1.5 py-0.5 text-xs">
            supabase/migrations/012_email_intake.sql
          </code>{" "}
          into the Supabase SQL Editor, then refresh. See{" "}
          <code className="rounded-md border border-amber-200 bg-white px-1.5 py-0.5 text-xs">
            EMAIL-INTAKE-SETUP.md
          </code>
          .
        </p>
      </div>
    );
  }

  const flashError = flash?.gmailError || flash?.outlookError;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
            Private intake
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            Email
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted">
            Connect Gmail or Outlook to see relevant threads here. Imported
            email stays private to you until you draft a parenting-team message.
            This pass does not send external email for you.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => void syncAll()}
            disabled={syncing || connections.length === 0}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <Link href="/app/messages" className={secondaryBtn}>
            Open Messages
          </Link>
        </div>
      </div>

      {flashError ? (
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-4 text-sm text-danger">
          Connect error: {flashError}
          {flashError === "not_configured"
            ? " Set OAuth env vars and redirect URIs (see EMAIL-INTAKE-SETUP.md)."
            : null}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="rounded-2xl border border-border bg-accent-soft/60 p-4 text-sm text-foreground">
          {status}
        </p>
      ) : null}

      <section className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-lg font-semibold text-foreground">
          Connected accounts
        </h2>
        <p className="mt-1 text-sm text-muted">
          Mail OAuth is separate from Calendar. Connecting calendars does not
          grant mail access.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {gmailConfigured ? (
            <a href="/api/email/gmail/connect" className={primaryBtn}>
              {connections.some((c) => c.provider === "gmail")
                ? "Reconnect Gmail"
                : "Connect Gmail"}
            </a>
          ) : (
            <span className={`${secondaryBtn} cursor-not-allowed opacity-60`}>
              Gmail not configured
            </span>
          )}
          {outlookConfigured ? (
            <a href="/api/email/outlook/connect" className={primaryBtn}>
              {connections.some((c) => c.provider === "outlook")
                ? "Reconnect Outlook"
                : "Connect Outlook"}
            </a>
          ) : (
            <span className={`${secondaryBtn} cursor-not-allowed opacity-60`}>
              Outlook mail not configured
            </span>
          )}
        </div>

        {connections.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No mail accounts connected yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {connections.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">
                    {providerLabel(c.provider)}
                    {c.external_account_email
                      ? ` · ${c.external_account_email}`
                      : ""}
                  </p>
                  <p className="text-xs text-muted">
                    Status: {c.status}
                    {c.last_synced_at
                      ? ` · Last sync ${formatWhen(c.last_synced_at)}`
                      : ""}
                    {c.last_error ? ` · ${c.last_error}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() => void disconnect(c.id, c.provider)}
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="rounded-3xl border border-border bg-card shadow-[var(--shadow-sm)]">
          <div className="border-b border-border p-4">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search private email…"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="p-5 text-sm text-muted">
                {connections.length === 0
                  ? "Connect an account to import recent threads."
                  : "No threads yet. Try Sync now."}
              </li>
            ) : (
              filtered.map((t) => {
                const active = t.id === selectedId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => void loadThread(t.id)}
                      className={`w-full px-4 py-3.5 text-left transition-colors ${
                        active
                          ? "bg-accent-soft/70"
                          : "hover:bg-surface"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 text-sm font-semibold text-foreground">
                          {t.subject || "(no subject)"}
                        </p>
                        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-border">
                          {providerLabel(t.provider)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">
                        {clip(t.snippet || "", 160) || "No preview"}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatWhen(t.last_message_at)}
                        {t.is_unread ? " · Unread" : ""}
                        {" · Private"}
                      </p>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <section className="rounded-3xl border border-border bg-card shadow-[var(--shadow-sm)]">
          {!selected ? (
            <div className="p-6 text-sm text-muted">
              Select a thread to read it. Content stays private to you.
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-border p-5">
                <h2 className="text-xl font-semibold text-foreground">
                  {selected.subject || "(no subject)"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {providerLabel(selected.provider)}
                  {selected.account_email
                    ? ` · ${selected.account_email}`
                    : ""}
                  {" · Private until drafted into Messages"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={primaryBtn}
                    onClick={() => void draftFromEmail()}
                    disabled={drafting}
                  >
                    {drafting
                      ? "Preparing draft…"
                      : "Draft message from email"}
                  </button>
                  <button
                    type="button"
                    className={secondaryBtn}
                    onClick={() => void draftFromEmail()}
                    disabled={drafting}
                    title="Same as draft: creates an in-app Messages draft grounded in this email"
                  >
                    Share to parenting team
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Opens Messages with a calm draft. Nothing is sent until you
                  review and send in-app. Raw mailbox content is not auto-shared.
                </p>
              </div>
              <div className="max-h-[28rem] flex-1 space-y-4 overflow-y-auto p-5">
                {messagesLoading ? (
                  <p className="text-sm text-muted">Loading…</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted">
                    No messages stored for this thread yet. Try Sync now.
                  </p>
                ) : (
                  messages.map((m) => (
                    <article
                      key={m.id}
                      className="rounded-2xl border border-border bg-surface p-4"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">
                          {m.from_addr || "Unknown sender"}
                          {m.is_from_me ? " (you)" : ""}
                        </p>
                        <p className="text-xs text-muted">
                          {formatWhen(m.sent_at)}
                        </p>
                      </div>
                      {m.to_addrs?.length ? (
                        <p className="mt-1 text-xs text-muted">
                          To: {m.to_addrs.join(", ")}
                        </p>
                      ) : null}
                      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
                        {m.body_text || m.snippet || "(empty)"}
                      </pre>
                    </article>
                  ))
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
