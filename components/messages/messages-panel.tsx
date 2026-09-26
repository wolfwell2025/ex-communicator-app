"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatTranscript } from "@/lib/households";
import {
  buildClientToneContext,
  REFERENCE_CHIPS,
  referenceSnippet,
  type ReferenceKind,
} from "@/lib/household-context";
import {
  escalatedWarning,
  looksHostileClient,
  TONE_OBJECTIVES,
  type ToneObjective,
} from "@/lib/tone-check";
import type { MessageWithSender } from "@/lib/types";

type ToneCoach = {
  severity?: string;
  warning: string;
  suggestion: string;
};

type Props = {
  householdId: string;
  householdName: string;
  userId: string;
  initialMessages: MessageWithSender[];
};

/** Escalate after this many distinct flagged drafts in one compose session. */
const ESCALATE_AFTER_FLAGS = 2;

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

const chipBtn =
  "inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent";

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
  const [toneCoach, setToneCoach] = useState<ToneCoach | null>(null);
  const [toneLoading, setToneLoading] = useState(false);
  const [toneDismissedFor, setToneDismissedFor] = useState<string | null>(null);
  const [flagCount, setFlagCount] = useState(0);
  const [objective, setObjective] = useState<ToneObjective | null>(null);
  const [objectiveLoading, setObjectiveLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const toneRequestId = useRef(0);
  const lastFlaggedTextRef = useRef<string | null>(null);
  const flagCountRef = useRef(0);
  const supabase = useMemo(() => createClient(), []);

  const toneContext = useMemo(
    () =>
      buildClientToneContext({
        messages,
        userId,
        // Stubs until calendar / documents / calls tables exist:
        calendarEvents: [],
        documents: [],
        callLogs: [],
      }),
    [messages, userId]
  );

  const escalated = flagCount >= ESCALATE_AFTER_FLAGS;
  const bodyHostile = looksHostileClient(body);
  const softBlocked = escalated && bodyHostile;

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

  useEffect(() => {
    const trimmed = body.trim();
    if (!trimmed || toneDismissedFor === trimmed) {
      if (!trimmed) setToneCoach(null);
      setToneLoading(false);
      return;
    }

    if (!looksHostileClient(trimmed)) {
      setToneCoach(null);
      setToneLoading(false);
      return;
    }

    const requestId = ++toneRequestId.current;
    setToneLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/tone-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: trimmed,
            context: toneContext,
            ...(objective ? { objective } : {}),
          }),
        });
        if (requestId !== toneRequestId.current) return;
        if (!res.ok) {
          setToneCoach(null);
          return;
        }
        const data = (await res.json()) as {
          flagged?: boolean;
          severity?: string;
          warning?: string;
          suggestion?: string;
        };
        if (requestId !== toneRequestId.current) return;
        if (data.flagged && data.warning && data.suggestion) {
          let nextCount = flagCountRef.current;
          if (lastFlaggedTextRef.current !== trimmed) {
            nextCount = flagCountRef.current + 1;
            flagCountRef.current = nextCount;
            lastFlaggedTextRef.current = trimmed;
            setFlagCount(nextCount);
          }
          const willEscalate = nextCount >= ESCALATE_AFTER_FLAGS;
          setToneCoach({
            severity: data.severity,
            warning: willEscalate ? escalatedWarning() : data.warning,
            suggestion: data.suggestion,
          });
        } else {
          setToneCoach(null);
        }
      } catch {
        if (requestId === toneRequestId.current) setToneCoach(null);
      } finally {
        if (requestId === toneRequestId.current) setToneLoading(false);
      }
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [body, toneDismissedFor, objective, toneContext]);

  function resetToneSession() {
    setToneCoach(null);
    setToneDismissedFor(null);
    flagCountRef.current = 0;
    lastFlaggedTextRef.current = null;
    setFlagCount(0);
    setObjective(null);
  }

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || sending) return;

    if (escalated && looksHostileClient(trimmed)) {
      setError(
        "Send is paused while this draft still looks hostile. Pick an objective below or use the suggested rewrite first."
      );
      return;
    }

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
    resetToneSession();
    setSending(false);
    await refresh();
  }

  function useToneSuggestion() {
    if (!toneCoach?.suggestion) return;
    const suggestion = toneCoach.suggestion;
    setBody(suggestion);
    setToneCoach(null);
    setToneDismissedFor(suggestion.trim());
    setError(null);
  }

  function dismissToneCoach() {
    setToneDismissedFor(body.trim());
    setToneCoach(null);
  }

  function applyReferenceChip(kind: ReferenceKind) {
    const snippet = referenceSnippet(kind, toneContext);
    setBody((prev) => {
      const next = prev.trim().length === 0 ? snippet : `${snippet}${prev}`;
      return next.slice(0, 10000);
    });
    setToneDismissedFor(null);
  }

  async function chooseObjective(next: ToneObjective) {
    setObjective(next);
    setObjectiveLoading(true);
    setError(null);
    setToneDismissedFor(null);
    try {
      const res = await fetch("/api/tone-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: body,
          objective: next,
          context: toneContext,
        }),
      });
      if (!res.ok) {
        setToneCoach({
          severity: "high",
          warning: escalatedWarning(),
          suggestion: referenceSnippet("message", toneContext) +
            "I'd like to keep this focused on the kids and next steps. Can we address the specific issue calmly?",
        });
        return;
      }
      const data = (await res.json()) as {
        warning?: string;
        suggestion?: string;
        severity?: string;
      };
      setToneCoach({
        severity: data.severity ?? "high",
        warning: escalatedWarning(),
        suggestion:
          data.suggestion ||
          referenceSnippet("message", toneContext) +
            "I'd like to keep this focused on the kids and next steps.",
      });
    } catch {
      setToneCoach({
        severity: "high",
        warning: escalatedWarning(),
        suggestion:
          referenceSnippet("message", toneContext) +
          "I'd like to keep this focused on the kids and next steps.",
      });
    } finally {
      setObjectiveLoading(false);
    }
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

  const showCoach = Boolean(toneCoach) || (escalated && bodyHostile);
  const coachWarning = toneCoach?.warning ?? (escalated ? escalatedWarning() : "");
  const coachSeverity =
    toneCoach?.severity ?? (escalated ? "high" : undefined);

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

        <div className="mb-3 flex flex-wrap gap-1.5">
          {REFERENCE_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={chipBtn}
              title={
                chip.stub
                  ? "Module coming soon — inserts grounded placeholder phrasing"
                  : "Insert a reference to the latest thread message"
              }
              onClick={() => applyReferenceChip(chip.id)}
            >
              {chip.label}
              {chip.stub ? (
                <span className="ml-1 text-[10px] font-medium text-muted">
                  soon
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1 space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              New message
            </span>
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                if (toneDismissedFor && e.target.value.trim() !== toneDismissedFor) {
                  setToneDismissedFor(null);
                }
              }}
              rows={3}
              maxLength={10000}
              placeholder="Write a clear, calm message…"
              className="w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-[15px] text-foreground shadow-[var(--shadow-sm)] placeholder:text-muted-foreground transition-colors hover:border-border-strong focus:border-accent focus:bg-card focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
              required
            />
          </label>
          <button
            type="submit"
            disabled={sending || !body.trim() || softBlocked}
            title={
              softBlocked
                ? "Pick an objective or use a suggested rewrite before sending"
                : undefined
            }
            className="shrink-0 rounded-2xl bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-[var(--shadow-md)] transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {sending ? "Sending…" : softBlocked ? "Send paused" : "Send message"}
          </button>
        </div>

        {toneLoading && !toneCoach ? (
          <p className="mt-3 text-xs text-muted" aria-live="polite">
            Checking tone…
          </p>
        ) : null}

        {showCoach ? (
          <div
            className={`mt-3 rounded-2xl border px-4 py-3.5 shadow-[var(--shadow-sm)] ${
              coachSeverity === "high" || escalated
                ? "border-red-200 bg-danger-soft"
                : "border-amber-200 bg-warning-soft"
            }`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 text-base" aria-hidden>
                {coachSeverity === "high" || escalated ? "⛔" : "⚠️"}
              </span>
              <div className="min-w-0 flex-1 space-y-2.5">
                <p
                  className={`text-sm font-semibold leading-5 ${
                    coachSeverity === "high" || escalated
                      ? "text-danger"
                      : "text-warning"
                  }`}
                >
                  {coachWarning}
                </p>

                {escalated ? (
                  <div className="rounded-xl border border-border/80 bg-card px-3.5 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      What are you trying to accomplish?
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      Pick one so we can draft a court-appropriate message that
                      cites your thread, calendar, documents, or calls when
                      available. Send stays paused while the draft still looks
                      hostile.
                    </p>
                    <div className="mt-2.5 flex flex-col gap-1.5">
                      {TONE_OBJECTIVES.map((opt) => {
                        const selected = objective === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            disabled={objectiveLoading}
                            onClick={() => void chooseObjective(opt.id)}
                            className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                              selected
                                ? "border-accent bg-accent-soft"
                                : "border-border bg-background hover:border-border-strong hover:bg-surface"
                            }`}
                          >
                            <span className="block text-sm font-semibold text-foreground">
                              {opt.label}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted">
                              {opt.hint}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {objectiveLoading ? (
                      <p className="mt-2 text-xs text-muted">
                        Drafting rewrite from household context…
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {toneCoach?.suggestion ? (
                  <div className="rounded-xl border border-border/80 bg-card px-3.5 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Suggested rewrite
                      {objective
                        ? ` · ${TONE_OBJECTIVES.find((o) => o.id === objective)?.label ?? ""}`
                        : ""}
                    </p>
                    <p className="mt-1.5 text-sm leading-6 text-foreground whitespace-pre-wrap">
                      {toneCoach.suggestion}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {REFERENCE_CHIPS.map((chip) => (
                        <button
                          key={`coach-${chip.id}`}
                          type="button"
                          className={chipBtn}
                          onClick={() => {
                            const snippet = referenceSnippet(chip.id, toneContext);
                            setToneCoach((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    suggestion: `${snippet}${prev.suggestion.replace(/^(Regarding|Following up)[^:]*:\s*/i, "")}`,
                                  }
                                : prev
                            );
                          }}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {toneCoach?.suggestion ? (
                    <button
                      type="button"
                      onClick={useToneSuggestion}
                      className="inline-flex items-center justify-center rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover"
                    >
                      Use suggestion
                    </button>
                  ) : null}
                  {!escalated ? (
                    <button
                      type="button"
                      onClick={dismissToneCoach}
                      className={secondaryBtn}
                    >
                      Dismiss
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <p className="mt-3 text-xs leading-5 text-muted">
          Sent messages are permanent for the household record.
          {softBlocked
            ? " Send is paused until you pick an objective or use a calm rewrite."
            : " Tone coaching uses your thread (and calendar/docs/calls when available) to suggest grounded rewrites."}
        </p>
      </form>
    </div>
  );
}
