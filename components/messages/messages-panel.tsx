"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  buildClientToneContext,
  messagesToContextRows,
  REFERENCE_CHIPS,
  type ReferenceKind,
} from "@/lib/household-context";
import {
  escalatedWarning,
  looksHostileClient,
  TONE_OBJECTIVES,
  type ToneObjective,
} from "@/lib/tone-check";
import type { FactLine } from "@/lib/reference-generate";
import {
  eventsToPickerItems,
  listSharedCalendarEvents,
} from "@/lib/calendar";
import {
  documentsToPickerItems,
  listSharedDocuments,
} from "@/lib/documents";
import type {
  HouseholdMemberProfile,
  MessageWithSender,
  ThreadListItem,
} from "@/lib/types";
import {
  createThread,
  filterThreads,
  formatThreadTranscript,
  listThreadMessages,
  listThreads,
  memberLabel,
  sendThreadReply,
} from "@/lib/messages";
import {
  ReferencePicker,
  type PickerCalendarItem,
  type PickerDocumentItem,
} from "@/components/messages/reference-picker";
import { SuggestionBanner } from "@/components/calendar/suggestion-banner";
import type { CalendarSuggestion } from "@/lib/types";

type ToneCoach = {
  severity?: string;
  warning: string;
  suggestion: string;
};

type Props = {
  householdId: string;
  householdName: string;
  userId: string;
  initialThreads: ThreadListItem[];
  initialMembers: HouseholdMemberProfile[];
  needsMigration: boolean;
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

function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    }
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
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

function previewText(body: string, max = 72): string {
  const one = body.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

function participantsLabel(
  participants: HouseholdMemberProfile[],
  userId: string
): string {
  const others = participants.filter((p) => p.user_id !== userId);
  if (others.length === 0) {
    return participants.length <= 1 ? "Just you" : "Household";
  }
  return others.map(memberLabel).join(", ");
}

const secondaryBtn =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface";

const chipBtn =
  "inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent";

export function MessagesPanel({
  householdId,
  householdName,
  userId,
  initialThreads,
  initialMembers,
  needsMigration: initialNeedsMigration,
}: Props) {
  const [threads, setThreads] = useState<ThreadListItem[]>(initialThreads);
  const [members] = useState<HouseholdMemberProfile[]>(initialMembers);
  const [needsMigration, setNeedsMigration] = useState(initialNeedsMigration);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(
    initialThreads[0]?.id ?? (initialNeedsMigration ? null : "new")
  );
  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [toUserIds, setToUserIds] = useState<string[]>(() =>
    initialMembers.filter((m) => m.user_id !== userId).map((m) => m.user_id)
  );
  const [householdTo, setHouseholdTo] = useState(true);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toneCoach, setToneCoach] = useState<ToneCoach | null>(null);
  const [toneLoading, setToneLoading] = useState(false);
  const [toneDismissedFor, setToneDismissedFor] = useState<string | null>(null);
  const [flagCount, setFlagCount] = useState(0);
  const [objective, setObjective] = useState<ToneObjective | null>(null);
  const [objectiveLoading, setObjectiveLoading] = useState(false);
  const [pickerKind, setPickerKind] = useState<ReferenceKind | null>(null);
  const [referenceSuggestion, setReferenceSuggestion] = useState<{
    text: string;
    facts: FactLine[];
  } | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<PickerCalendarItem[]>([]);
  const [documents, setDocuments] = useState<PickerDocumentItem[]>([]);
  const [suggestions, setSuggestions] = useState<CalendarSuggestion[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const coachRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const toneRequestId = useRef(0);
  const lastFlaggedTextRef = useRef<string | null>(null);
  const flagCountRef = useRef(0);
  const supabase = useMemo(() => createClient(), []);

  const otherMembers = useMemo(
    () => members.filter((m) => m.user_id !== userId),
    [members, userId]
  );
  const soloHousehold = otherMembers.length === 0;

  const selectedThread = useMemo(
    () =>
      selectedId && selectedId !== "new"
        ? threads.find((t) => t.id === selectedId) ?? null
        : null,
    [selectedId, threads]
  );

  const filteredThreads = useMemo(
    () => filterThreads(threads, search, userId),
    [threads, search, userId]
  );

  const toneContext = useMemo(
    () =>
      buildClientToneContext({
        messages,
        userId,
        calendarEvents,
        documents,
        callLogs: [],
      }),
    [messages, userId, calendarEvents, documents]
  );

  const pickerMessages = useMemo(
    () => messagesToContextRows(messages, userId),
    [messages, userId]
  );

  const refreshCalendar = useCallback(async () => {
    const { events, error: calErr } = await listSharedCalendarEvents(
      supabase,
      householdId,
      { from: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(), limit: 40 }
    );
    if (calErr) {
      setCalendarEvents([]);
      return;
    }
    setCalendarEvents(eventsToPickerItems(events));
  }, [householdId, supabase]);

  const refreshDocuments = useCallback(async () => {
    const { documents: rows, error: docsErr } = await listSharedDocuments(
      supabase,
      householdId,
      { limit: 40 }
    );
    if (docsErr) {
      setDocuments([]);
      return;
    }
    setDocuments(documentsToPickerItems(rows));
  }, [householdId, supabase]);

  const refreshSuggestions = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/suggestions");
      if (!res.ok) {
        setSuggestions([]);
        return;
      }
      const json = (await res.json()) as {
        suggestions?: CalendarSuggestion[];
      };
      setSuggestions(json.suggestions ?? []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const scanThread = useCallback(async (threadId: string) => {
    try {
      await fetch("/api/calendar/suggestions/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId }),
      });
      await refreshSuggestions();
    } catch {
      // non-fatal
    }
  }, [refreshSuggestions]);

  useEffect(() => {
    void refreshCalendar();
    void refreshDocuments();
    void refreshSuggestions();
  }, [refreshCalendar, refreshDocuments, refreshSuggestions]);

  const escalated = flagCount >= ESCALATE_AFTER_FLAGS;
  const bodyHostile = looksHostileClient(body);
  const softBlocked = escalated && bodyHostile;

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const refreshThreadList = useCallback(async () => {
    const { threads: next, error: err, needsMigration: mig } = await listThreads(
      supabase,
      householdId
    );
    if (mig) {
      setNeedsMigration(true);
      return;
    }
    if (err) {
      setError(err);
      return;
    }
    setNeedsMigration(false);
    setThreads(next);
  }, [householdId, supabase]);

  const loadMessages = useCallback(
    async (threadId: string) => {
      setMessagesLoading(true);
      const { messages: rows, error: err } = await listThreadMessages(
        supabase,
        threadId
      );
      setMessagesLoading(false);
      if (err) {
        setError(err);
        setMessages([]);
        return;
      }
      setMessages(rows);
    },
    [supabase]
  );

  useEffect(() => {
    if (!selectedId || selectedId === "new") {
      const t = window.setTimeout(() => setMessages([]), 0);
      return () => window.clearTimeout(t);
    }
    void loadMessages(selectedId).then(() => {
      void scanThread(selectedId);
    });
  }, [selectedId, loadMessages, scanThread]);

  useEffect(() => {
    if (needsMigration) return;
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
          void refreshThreadList();
          if (selectedId && selectedId !== "new") {
            void loadMessages(selectedId);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_threads",
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          void refreshThreadList();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [
    householdId,
    loadMessages,
    needsMigration,
    refreshThreadList,
    selectedId,
    supabase,
  ]);

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
    setReferenceSuggestion(null);
  }

  function startNewMessage() {
    setSelectedId("new");
    setSubject("");
    setToUserIds(soloHousehold ? [] : otherMembers.map((m) => m.user_id));
    setHouseholdTo(soloHousehold || otherMembers.length > 0);
    setBody("");
    resetToneSession();
    setError(null);
  }

  function toggleRecipient(id: string) {
    setHouseholdTo(false);
    setToUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function selectHouseholdTo() {
    setHouseholdTo(true);
    setToUserIds(otherMembers.map((m) => m.user_id));
  }

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || sending || needsMigration) return;

    if (escalated && looksHostileClient(trimmed)) {
      setError(
        "Send is paused while this draft still looks hostile. Pick an objective below or use the suggested rewrite first."
      );
      return;
    }

    setSending(true);
    setError(null);

    if (selectedId === "new") {
      const subj = subject.trim();
      if (!subj) {
        setError("Add a subject for this message.");
        setSending(false);
        return;
      }
      if (!householdTo && toUserIds.length === 0 && !soloHousehold) {
        setError("Choose at least one recipient, or select Household.");
        setSending(false);
        return;
      }

      const participantIds = householdTo
        ? members.map((m) => m.user_id)
        : [...new Set([userId, ...toUserIds])];

      const { threadId, error: createErr, needsMigration: mig } =
        await createThread(supabase, {
          householdId,
          subject: subj,
          participantIds,
          body: trimmed,
        });

      if (mig) {
        setNeedsMigration(true);
        setError(
          "Message threads are not set up yet. Run supabase/migrations/006_message_threads.sql in the Supabase SQL Editor."
        );
        setSending(false);
        return;
      }
      if (createErr || !threadId) {
        setError(createErr ?? "Could not create message.");
        setSending(false);
        return;
      }

      setBody("");
      setSubject("");
      resetToneSession();
      setSending(false);
      await refreshThreadList();
      setSelectedId(threadId);
      void scanThread(threadId);
      return;
    }

    if (!selectedId) {
      setSending(false);
      return;
    }

    const { error: replyErr } = await sendThreadReply(supabase, {
      householdId,
      threadId: selectedId,
      userId,
      body: trimmed,
    });

    if (replyErr) {
      setError(replyErr);
      setSending(false);
      return;
    }

    setBody("");
    resetToneSession();
    setSending(false);
    await loadMessages(selectedId);
    await refreshThreadList();
    void scanThread(selectedId);
  }

  function useToneSuggestion() {
    if (!toneCoach?.suggestion) return;
    const suggestion = toneCoach.suggestion;
    setBody(suggestion);
    setToneCoach(null);
    setToneDismissedFor(suggestion.trim());
    setError(null);
  }

  function useReferenceSuggestion() {
    if (!referenceSuggestion?.text) return;
    const suggestion = referenceSuggestion.text;
    setBody(suggestion);
    setReferenceSuggestion(null);
    setToneDismissedFor(suggestion.trim());
    setError(null);
  }

  function dismissToneCoach() {
    setToneDismissedFor(body.trim());
    setToneCoach(null);
  }

  function openReferencePicker(kind: ReferenceKind) {
    setPickerKind(kind);
    setError(null);
  }

  function onReferenceGenerated(suggestion: string, facts: FactLine[]) {
    setReferenceSuggestion({ text: suggestion, facts });
    setToneDismissedFor(null);
    setError(null);
  }

  async function chooseObjective(next: ToneObjective) {
    setObjective(next);
    setObjectiveLoading(true);
    setError(null);
    setToneDismissedFor(null);
    const calmFallback =
      "I'd like to keep this focused on the kids and next steps. Can we address the specific issue calmly?";
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
          suggestion: calmFallback,
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
        suggestion: data.suggestion || calmFallback,
      });
    } catch {
      setToneCoach({
        severity: "high",
        warning: escalatedWarning(),
        suggestion: calmFallback,
      });
    } finally {
      setObjectiveLoading(false);
    }
  }

  function downloadTranscript() {
    if (!selectedThread) return;
    const text = formatThreadTranscript(
      selectedThread,
      messages,
      householdName
    );
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    const safeSubject = selectedThread.subject
      .replace(/[^\w\-]+/g, "-")
      .slice(0, 40);
    a.href = url;
    a.download = `ex-communicator-${safeSubject}-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const showCoach = Boolean(toneCoach) || (escalated && bodyHostile);
  const coachWarning = toneCoach?.warning ?? (escalated ? escalatedWarning() : "");
  const coachSeverity =
    toneCoach?.severity ?? (escalated ? "high" : undefined);

  const canSendNew =
    selectedId === "new" &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    (householdTo || toUserIds.length > 0 || soloHousehold);

  const canSendReply =
    selectedId !== null &&
    selectedId !== "new" &&
    body.trim().length > 0;


  useEffect(() => {
    if (!showCoach) return;
    const t = window.setTimeout(() => {
      coachRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      // Also ensure the composer form scrolls if coach sits below the fold inside it
      if (coachRef.current && composerFormRef.current) {
        const form = composerFormRef.current;
        const coach = coachRef.current;
        const formRect = form.getBoundingClientRect();
        const coachRect = coach.getBoundingClientRect();
        if (coachRect.bottom > formRect.bottom - 8 || coachRect.top < formRect.top) {
          coach.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    }, 50);
    return () => window.clearTimeout(t);
  }, [showCoach, escalated, toneCoach?.suggestion, objectiveLoading]);

  const composerReady =
    !sending &&
    !softBlocked &&
    !needsMigration &&
    (selectedId === "new" ? canSendNew : canSendReply);

  return (
    <div className="flex h-[min(82vh,900px)] flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-lg)] lg:flex-row">
      {/* Left: thread list */}
      <aside className="flex w-full shrink-0 flex-col border-b border-border bg-card lg:w-[20rem] lg:border-b-0 lg:border-r">
        <div className="space-y-3 border-b border-border px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Messages
              </h1>
              <p className="text-xs text-muted">{householdName}</p>
            </div>
            <button
              type="button"
              onClick={startNewMessage}
              disabled={needsMigration}
              className="rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              New
            </button>
          </div>
          <label className="block">
            <span className="sr-only">Search messages</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subjects, people, previews…"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-[var(--shadow-sm)] placeholder:text-muted-foreground transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto">
          {needsMigration ? (
            <div className="m-3 rounded-2xl border border-amber-200 bg-warning-soft p-3 text-xs leading-5 text-warning">
              Run{" "}
              <code className="rounded bg-white px-1 py-0.5 text-[10px] text-foreground">
                006_message_threads.sql
              </code>{" "}
              in Supabase to enable subjects, recipients, and search.
            </div>
          ) : null}

          {filteredThreads.length === 0 && !needsMigration ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              {search.trim()
                ? "No threads match your search."
                : "No threads yet. Start a new message."}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filteredThreads.map((thread) => {
                const active = selectedId === thread.id;
                const toLabel = participantsLabel(thread.participants, userId);
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(thread.id);
                        resetToneSession();
                        setBody("");
                        setError(null);
                      }}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        active
                          ? "bg-accent-soft"
                          : "hover:bg-surface"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {thread.subject}
                        </p>
                        <time className="shrink-0 text-[10px] text-muted">
                          {formatShortTime(
                            thread.last_message?.created_at ?? thread.updated_at
                          )}
                        </time>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted">
                        To: {toLabel}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted">
                        {thread.last_message
                          ? previewText(thread.last_message.body)
                          : "No messages yet"}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Right: thread / compose */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {selectedId === "new" ? (
              <>
                <p className="text-lg font-semibold text-foreground">
                  New message
                </p>
                <p className="text-xs text-muted">
                  Subject and recipients, then write your message.
                </p>
              </>
            ) : selectedThread ? (
              <>
                <p className="truncate text-lg font-semibold text-foreground">
                  {selectedThread.subject}
                </p>
                <p className="truncate text-xs text-muted">
                  To: {participantsLabel(selectedThread.participants, userId)}
                  <span className="mx-1.5 text-border-strong">·</span>
                  {selectedThread.message_count} message
                  {selectedThread.message_count === 1 ? "" : "s"}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">Select a thread or start new.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedThread ? (
              <button
                type="button"
                onClick={downloadTranscript}
                className={secondaryBtn}
              >
                Download transcript
              </button>
            ) : null}
            <Link href="/app/messages/export" className={secondaryBtn}>
              Print / PDF
            </Link>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-background px-4 py-4 sm:px-5">
          {selectedId && selectedId !== "new" && suggestions.length > 0 ? (
            <SuggestionBanner
              suggestions={suggestions.filter((s) => {
                if (s.source_type !== "message") return true;
                if (messages.length === 0) return true;
                const ids = new Set(messages.map((m) => m.id));
                return s.source_ids.some((id) => ids.has(id));
              })}
              onChanged={refreshSuggestions}
              title="Add to calendar?"
            />
          ) : null}
          {selectedId === "new" ? (
            <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center shadow-[var(--shadow-sm)]">
              <p className="text-base font-semibold text-foreground">
                Compose below
              </p>
              <p className="mt-1 text-sm text-muted">
                Add a subject and choose who this is for. Messages cannot be
                edited or deleted once sent.
              </p>
            </div>
          ) : selectedThread ? (
            messagesLoading ? (
              <p className="text-sm text-muted">Loading messages…</p>
            ) : messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center shadow-[var(--shadow-sm)]">
                <p className="text-base font-semibold text-foreground">
                  No messages in this thread
                </p>
                <p className="mt-1 text-sm text-muted">
                  Send the first reply below.
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
                      <p className="whitespace-pre-wrap leading-7">
                        {message.body}
                      </p>
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
            )
          ) : (
            <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted">
              Choose a conversation from the list.
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {selectedId ? (
          <form
            ref={composerFormRef}
            onSubmit={onSend}
            className="max-h-[min(52vh,560px)] shrink-0 overflow-y-auto border-t border-border bg-card px-4 py-4 sm:px-5"
          >
            {error ? (
              <p
                className="mb-3 rounded-xl border border-red-200 bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            {selectedId === "new" ? (
              <div className="mb-3 space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Subject
                  </span>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Weekend pickup, School conference…"
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] placeholder:text-muted-foreground transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                    required
                  />
                </label>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    To
                  </span>
                  {soloHousehold ? (
                    <div className="rounded-xl border border-border bg-surface px-3.5 py-3 text-sm text-muted">
                      <p>
                        <span className="font-semibold text-foreground">
                          Household
                        </span>{" "}
                        — you are the only member so far.
                      </p>
                      <p className="mt-1 text-xs">
                        Invite a co-parent from the Dashboard so you can choose
                        recipients here.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={selectHouseholdTo}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          householdTo
                            ? "border-accent bg-accent-soft text-accent"
                            : "border-border bg-background text-foreground hover:border-accent"
                        }`}
                      >
                        Household
                      </button>
                      {otherMembers.map((m) => {
                        const selected =
                          !householdTo && toUserIds.includes(m.user_id);
                        return (
                          <button
                            key={m.user_id}
                            type="button"
                            onClick={() => toggleRecipient(m.user_id)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                              selected
                                ? "border-accent bg-accent-soft text-accent"
                                : "border-border bg-background text-foreground hover:border-accent"
                            }`}
                          >
                            {memberLabel(m)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="mb-3 flex flex-wrap gap-1.5">
              {REFERENCE_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={chipBtn}
                  title={
                    chip.stub
                      ? "Opens picker — empty until that module has real data"
                      : "Pick a real thread message, confirm facts, then generate"
                  }
                  onClick={() => openReferencePicker(chip.id)}
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
                  {selectedId === "new" ? "Message" : "Reply"}
                </span>
                <textarea
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    if (
                      toneDismissedFor &&
                      e.target.value.trim() !== toneDismissedFor
                    ) {
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
                disabled={!composerReady}
                title={
                  softBlocked
                    ? "Pick an objective or use a suggested rewrite before sending"
                    : needsMigration
                      ? "Run migration 006 first"
                      : undefined
                }
                className="shrink-0 rounded-2xl bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-[var(--shadow-md)] transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {sending
                  ? "Sending…"
                  : softBlocked
                    ? "Send paused"
                    : selectedId === "new"
                      ? "Send message"
                      : "Send reply"}
              </button>
            </div>

            {referenceSuggestion ? (
              <div
                className="mt-3 rounded-2xl border border-border bg-accent-soft/40 px-4 py-3.5 shadow-[var(--shadow-sm)]"
                role="status"
                aria-live="polite"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Generated from selected record
                </p>
                {referenceSuggestion.facts.length > 0 ? (
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Cited:{" "}
                    {referenceSuggestion.facts.map((f) => f.label).join(", ")}
                  </p>
                ) : null}
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {referenceSuggestion.text}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={useReferenceSuggestion}
                    className="inline-flex items-center justify-center rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover"
                  >
                    Use suggestion
                  </button>
                  <button
                    type="button"
                    onClick={() => setReferenceSuggestion(null)}
                    className={secondaryBtn}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}

            {toneLoading && !toneCoach ? (
              <p className="mt-3 text-xs text-muted" aria-live="polite">
                Checking tone…
              </p>
            ) : null}

            {showCoach ? (
              <div
                ref={coachRef}
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
                          Pick one so we can draft a court-appropriate message.
                          Use Reference chips above to ground it in a real
                          thread message. Send stays paused while the draft
                          still looks hostile.
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
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-foreground">
                          {toneCoach.suggestion}
                        </p>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {REFERENCE_CHIPS.map((chip) => (
                            <button
                              key={`coach-${chip.id}`}
                              type="button"
                              className={chipBtn}
                              onClick={() => openReferencePicker(chip.id)}
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
                : " Reference chips open a picker of real shared items only."}
            </p>
          </form>
        ) : null}
      </section>

      {pickerKind ? (
        <ReferencePicker
          kind={pickerKind}
          open={Boolean(pickerKind)}
          onClose={() => setPickerKind(null)}
          onGenerated={onReferenceGenerated}
          messages={pickerMessages}
          calendarEvents={calendarEvents}
          documents={documents}
          callLogs={[]}
        />
      ) : null}
    </div>
  );
}
