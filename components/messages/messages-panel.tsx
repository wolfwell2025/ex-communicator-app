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
    <div className="flex h-[min(70vh,720px)] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
          <p className="mt-1 text-sm text-muted">
            Household: <span className="font-medium text-foreground">{householdName}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadTranscript}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-accent"
          >
            Download transcript
          </button>
          <Link
            href="/app/messages/export"
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-accent"
          >
            Print / PDF export
          </Link>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-muted">
              No messages yet. Send the first one below. Messages cannot be edited
              or deleted once sent.
            </p>
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
                  className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm ${
                    mine
                      ? "ml-auto bg-accent text-white"
                      : "mr-auto bg-background border border-border text-foreground"
                  }`}
                >
                  <div
                    className={`mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs ${
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
            <p className="mb-2 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block flex-1 space-y-1.5">
              <span className="sr-only">Message</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={10000}
                placeholder="Write a message..."
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                required
              />
            </label>
            <button
              type="submit"
              disabled={sending || !body.trim()}
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Sent messages are permanent for the household record.
          </p>
        </form>
      </div>
    </div>
  );
}
