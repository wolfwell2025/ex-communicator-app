import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createCalendarEvent,
  type CalendarEventInput,
} from "./calendar";
import {
  extractDocumentDates,
  findConfirmedSuggestionsInThread,
  type MessageLike,
} from "./date-extract";
import type { CalendarSuggestion } from "./types";

const SELECT_COLS =
  "id, household_id, source_type, source_key, source_ids, title, starts_at, ends_at, all_day, status, suggested_visibility, created_for, proposer_id, event_id, created_at, updated_at";

export async function listPendingSuggestions(
  supabase: SupabaseClient,
  args: { householdId: string; userId: string }
): Promise<{ suggestions: CalendarSuggestion[]; error: string | null }> {
  const { data, error } = await supabase
    .from("calendar_suggestions")
    .select(SELECT_COLS)
    .eq("household_id", args.householdId)
    .eq("created_for", args.userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return { suggestions: [], error: error.message };
  }
  return { suggestions: (data ?? []) as CalendarSuggestion[], error: null };
}

async function upsertSuggestion(
  supabase: SupabaseClient,
  row: {
    household_id: string;
    source_type: "message" | "document";
    source_key: string;
    source_ids: string[];
    title: string;
    starts_at: string;
    ends_at: string;
    all_day: boolean;
    created_for: string;
    proposer_id: string | null;
  }
): Promise<{ created: boolean; error: string | null }> {
  // Skip if any row already exists for this user+key (accepted/dismissed/pending)
  const { data: existing } = await supabase
    .from("calendar_suggestions")
    .select("id, status")
    .eq("created_for", row.created_for)
    .eq("source_key", row.source_key)
    .maybeSingle();

  if (existing?.id) {
    return { created: false, error: null };
  }

  const { error } = await supabase.from("calendar_suggestions").insert({
    ...row,
    status: "pending",
    suggested_visibility: "private",
  });

  if (error) {
    // Unique race → treat as already present
    if (error.message.toLowerCase().includes("duplicate") || error.code === "23505") {
      return { created: false, error: null };
    }
    return { created: false, error: error.message };
  }
  return { created: true, error: null };
}

/**
 * Scan a thread for confirmed date/time proposals and persist suggestions
 * for the confirmer (and optionally the proposer).
 */
export async function scanThreadForSuggestions(
  supabase: SupabaseClient,
  args: {
    householdId: string;
    threadId: string;
    threadSubject?: string;
    messages?: MessageLike[];
  }
): Promise<{ created: number; error: string | null }> {
  let messages = args.messages;
  if (!messages) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("thread_id", args.threadId)
      .order("created_at", { ascending: true });
    if (error) return { created: 0, error: error.message };
    messages = (data ?? []) as MessageLike[];
  }

  const candidates = findConfirmedSuggestionsInThread(messages, {
    threadSubject: args.threadSubject,
  });

  let created = 0;
  for (const c of candidates) {
    const base = {
      household_id: args.householdId,
      source_type: "message" as const,
      source_key: c.sourceKey,
      source_ids: c.sourceIds,
      title: c.title,
      starts_at: c.extracted.startsAt.toISOString(),
      ends_at: c.extracted.endsAt.toISOString(),
      all_day: c.extracted.allDay,
      proposer_id: c.proposerId,
    };

    // Prompt the confirmer
    const forConfirmer = await upsertSuggestion(supabase, {
      ...base,
      created_for: c.confirmerId,
    });
    if (forConfirmer.error) return { created, error: forConfirmer.error };
    if (forConfirmer.created) created += 1;

    // Also prompt the proposer (different key suffix so both can act)
    if (c.proposerId !== c.confirmerId) {
      const forProposer = await upsertSuggestion(supabase, {
        ...base,
        source_key: `${c.sourceKey}:proposer`,
        created_for: c.proposerId,
      });
      if (forProposer.error) return { created, error: forProposer.error };
      if (forProposer.created) created += 1;
    }
  }

  return { created, error: null };
}

/** Upsert document-based date suggestions for the viewing user. */
export async function ensureDocumentSuggestions(
  supabase: SupabaseClient,
  args: {
    householdId: string;
    userId: string;
    documentId: string;
    title: string;
    description?: string | null;
    bodyText?: string | null;
  }
): Promise<{ suggestions: CalendarSuggestion[]; error: string | null }> {
  const chips = extractDocumentDates({
    documentId: args.documentId,
    title: args.title,
    description: args.description,
    bodyText: args.bodyText,
  });

  for (const chip of chips) {
    await upsertSuggestion(supabase, {
      household_id: args.householdId,
      source_type: "document",
      source_key: chip.sourceKey,
      source_ids: chip.sourceIds,
      title: chip.title,
      starts_at: chip.extracted.startsAt.toISOString(),
      ends_at: chip.extracted.endsAt.toISOString(),
      all_day: chip.extracted.allDay,
      created_for: args.userId,
      proposer_id: null,
    });
  }

  const { data, error } = await supabase
    .from("calendar_suggestions")
    .select(SELECT_COLS)
    .eq("created_for", args.userId)
    .eq("source_type", "document")
    .eq("status", "pending")
    .contains("source_ids", [args.documentId])
    .order("starts_at", { ascending: true });

  if (error) return { suggestions: [], error: error.message };
  return { suggestions: (data ?? []) as CalendarSuggestion[], error: null };
}

export async function dismissSuggestion(
  supabase: SupabaseClient,
  args: { suggestionId: string; userId: string }
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("calendar_suggestions")
    .update({ status: "dismissed" })
    .eq("id", args.suggestionId)
    .eq("created_for", args.userId)
    .eq("status", "pending");
  return { error: error?.message ?? null };
}

export async function acceptSuggestion(
  supabase: SupabaseClient,
  args: {
    suggestionId: string;
    userId: string;
    householdId: string;
    visibility: "private" | "pending";
  }
): Promise<{ eventId: string | null; error: string | null }> {
  const { data: suggestion, error: loadErr } = await supabase
    .from("calendar_suggestions")
    .select(SELECT_COLS)
    .eq("id", args.suggestionId)
    .eq("created_for", args.userId)
    .eq("status", "pending")
    .maybeSingle();

  if (loadErr) return { eventId: null, error: loadErr.message };
  if (!suggestion) return { eventId: null, error: "Suggestion not found." };

  const input: CalendarEventInput = {
    title: suggestion.title,
    starts_at: suggestion.starts_at,
    ends_at: suggestion.ends_at,
    all_day: suggestion.all_day,
    event_type: "other",
    visibility: args.visibility,
  };

  const { event, error: createErr } = await createCalendarEvent(supabase, {
    householdId: args.householdId,
    userId: args.userId,
    input,
  });
  if (createErr || !event) {
    return { eventId: null, error: createErr ?? "Could not create event." };
  }

  const { error: updErr } = await supabase
    .from("calendar_suggestions")
    .update({
      status: "accepted",
      suggested_visibility: args.visibility,
      event_id: event.id,
    })
    .eq("id", args.suggestionId)
    .eq("created_for", args.userId);

  if (updErr) {
    return { eventId: event.id, error: updErr.message };
  }
  return { eventId: event.id, error: null };
}

export function formatSuggestionWhen(s: CalendarSuggestion): string {
  try {
    const start = new Date(s.starts_at);
    if (s.all_day) {
      return start.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }
    return start.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return s.starts_at;
  }
}
