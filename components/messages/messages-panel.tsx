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

const secondaryBtn =
  "inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface";

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
    <div className="flex h-[min(72vh,760px)] flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Messages
          </h1>
          <p className="text-sm text-muted">
            Household{" "}
            <span className="font-medium text-foreground">{householdName}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadTranscript} className={secondaryBtn}>
            Download transcript
          </button>
          <Link href="/app/messages/export" className={secondaryBtn}>
            Print / PDF export
          </Link>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface/60 px-4 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Thread
          </p>
          <p className="text-xs text-muted">
            {messages.length} message{messages.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-surface/40 px-4 py-4 sm:px-5">
          {messages.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
              <p className="text-sm font-medium text-foreground">No messages yet</p>
              <p className="mt-1 max-w-sm text-sm leading-6 text-muted">
                Send the first message below. Messages cannot be edited or
                deleted once sent.
              </p>
            </div>
          ) : (
            messages.map((message) => {
              const mine = message.sender_id === userId;
              const who =
                message.sender_email ??
                message.sender_display_name ??
                "Unknown sender";
              return (
                <div
                  key={message.id}
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[min(85%,36rem)] rounded-xl px-3.5 py-2.5 text-sm shadow-[var(--shadow-sm)] ${
                      mine
                        ? "bg-accent text-white"
                        : "border border-border bg-card text-foreground"
                    }`}
                  >
                    <div
                      className={`mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] ${
                        mine ? "text-blue-100" : "text-muted"
                      }`}
                    >
                      <span className="font-medium">{who}</span>
                      <time dateTime={message.created_at}>
                        {formatTime(message.created_at)}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap leading-6">{message.body}</p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={onSend}
          className="border-t border-border bg-card p-3 sm:p-4"
        >
          {error ? (
            <p
              className="mb-2 rounded-lg border border-red-200 bg-danger-soft px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
            <label className="block flex-1 space-y-1.5">
              <span className="sr-only">Message</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={10000}
                placeholder="Write a message…"
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] placeholder:text-muted-foreground transition-colors hover:border-border-strong focus:border-accent focus:bg-card focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                required
              />
            </label>
            <button
              type="submit"
              disabled={sending || !body.trim()}
              className="shrink-0 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          <p className="mt-2.5 text-xs leading-5 text-muted">
            Sent messages are permanent for the household record.
          </p>
        </form>
      </div>
    </div>
  );
}
