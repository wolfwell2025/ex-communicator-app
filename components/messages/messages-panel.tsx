"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatTranscript } from "@/lib/households";
import type { MessageWithSender } from "@/lib/types";

type Props = {
  householdId: string;
  householdName: string;
  userId: string;
  initialMessages: MessageWithSender[];
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function initials(label: string): string {
  const parts = label.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

const secondaryBtn =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface";

export function MessagesPanel({
  householdId,
  householdName,
  userId,
  initialMessages,
}: Props) {
  const [messages, setMessages] = useState<MessageWithSender[]>(initialMessages);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const refresh = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("messages")
      .select("id, household_id, sender_id, body, created_at")
      .eq("household_id", householdId)
      .order("created_at", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    const rows = data ?? [];
    const senderIds = [...new Set(rows.map((r) => r.sender_id))];
    const profilesById: Record<
      string,
      { email: string | null; display_name: string | null }
    > = {};

    if (senderIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, display_name")
        .in("id", senderIds);
      for (const p of profiles ?? []) {
        profilesById[p.id] = { email: p.email, display_name: p.display_name };
      }
    }

    setMessages(
      rows.map((row) => ({
        ...row,
        sender_email: profilesById[row.sender_id]?.email ?? null,
        sender_display_name: profilesById[row.sender_id]?.display_name ?? null,
      }))
    );
  }, [householdId, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`messages:${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
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

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);

    const { error: insertError } = await supabase.from("messages").insert({
      household_id: householdId,
      sender_id: userId,
      body: trimmed,
    });

    if (insertError) {
      setError(insertError.message);
      setSending(false);
      return;
    }

    setBody("");
    setSending(false);
    await refresh();
  }

  function downloadTranscript() {
    const text = formatTranscript(messages, householdName);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `ex-communicator-transcript-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-[min(78vh,840px)] flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-lg)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-5 py-4 sm:px-6">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Messages
            </h1>
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
              Live
            </span>
          </div>
          <p className="text-sm text-muted">
            Household{" "}
            <span className="font-semibold text-foreground">{householdName}</span>
            <span className="mx-2 text-border-strong">·</span>
            {messages.length} message{messages.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadTranscript} className={secondaryBtn}>
            Download transcript
          </button>
          <Link href="/app/messages/export" className={secondaryBtn}>
            Print / PDF
          </Link>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto bg-background px-4 py-5 sm:px-6">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center shadow-[var(--shadow-sm)]">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-2xl">
              ✉️
            </div>
            <p className="text-lg font-semibold text-foreground">No messages yet</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted">
              Send the first message below. Messages cannot be edited or deleted
              once sent — that keeps the household record court-ready.
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.sender_id === userId;
            const who =
              message.sender_display_name ??
              message.sender_email ??
              "Unknown sender";
            return (
              <div
                key={message.id}
                className={`flex items-end gap-2.5 ${mine ? "justify-end" : "justify-start"}`}
              >
                {!mine ? (
                  <div
                    className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-muted ring-1 ring-border"
                    aria-hidden
                  >
                    {initials(who)}
                  </div>
                ) : null}
                <div
                  className={`max-w-[min(88%,34rem)] px-4 py-3 text-[15px] shadow-[var(--shadow-sm)] ${
                    mine
                      ? "rounded-3xl rounded-br-md bg-accent text-white"
                      : "rounded-3xl rounded-bl-md border border-border bg-card text-foreground"
                  }`}
                >
                  <div
                    className={`mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] font-medium ${
                      mine ? "text-blue-100" : "text-muted"
                    }`}
                  >
                    <span>{who}</span>
                    <time dateTime={message.created_at}>
                      {formatTime(message.created_at)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap leading-7">{message.body}</p>
                </div>
                {mine ? (
                  <div
                    className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white"
                    aria-hidden
                  >
                    You
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={onSend}
        className="border-t border-border bg-card px-4 py-4 sm:px-6"
      >
        {error ? (
          <p
            className="mb-3 rounded-xl border border-red-200 bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1 space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              New message
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={10000}
              placeholder="Write a clear, calm message…"
              className="w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-[15px] text-foreground shadow-[var(--shadow-sm)] placeholder:text-muted-foreground transition-colors hover:border-border-strong focus:border-accent focus:bg-card focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              required
            />
          </label>
          <button
            type="submit"
            disabled={sending || !body.trim()}
            className="shrink-0 rounded-2xl bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-[var(--shadow-md)] transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send message"}
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">
          Sent messages are permanent for the household record.
        </p>
      </form>
    </div>
  );
}
