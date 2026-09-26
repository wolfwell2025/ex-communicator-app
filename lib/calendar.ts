import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CalendarEvent,
  CalendarEventType,
  CalendarVisibility,
  PersonalCalendarConnection,
} from "./types";

export const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  parenting_time: "Parenting time",
  school: "School",
  medical: "Medical",
  activity: "Activity",
  other: "Other",
};

export const EVENT_TYPES: CalendarEventType[] = [
  "parenting_time",
  "school",
  "medical",
  "activity",
  "other",
];

export const VISIBILITY_LABELS: Record<CalendarVisibility, string> = {
  private: "Private (only you)",
  pending: "Proposed (awaiting accept)",
  shared: "Shared with household",
};

const SELECT_COLS =
  "id, household_id, title, description, starts_at, ends_at, all_day, location, event_type, visibility, proposed_at, proposed_by, accepted_at, accepted_by, source, external_id, connection_id, created_by, created_at, updated_at";

export async function listCalendarEvents(
  supabase: SupabaseClient,
  householdId: string,
  options?: { from?: string; to?: string }
): Promise<{ events: CalendarEvent[]; error: string | null }> {
  let query = supabase
    .from("calendar_events")
    .select(SELECT_COLS)
    .eq("household_id", householdId)
    .order("starts_at", { ascending: true });

  if (options?.from) {
    query = query.gte("ends_at", options.from);
  }
  if (options?.to) {
    query = query.lte("starts_at", options.to);
  }

  const { data, error } = await query;
  if (error) {
    return { events: [], error: error.message };
  }
  return { events: (data ?? []) as CalendarEvent[], error: null };
}

/** Shared events only — for Reference picker / tone context (never private/pending of others). */
export async function listSharedCalendarEvents(
  supabase: SupabaseClient,
  householdId: string,
  options?: { from?: string; limit?: number }
): Promise<{ events: CalendarEvent[]; error: string | null }> {
  let query = supabase
    .from("calendar_events")
    .select(SELECT_COLS)
    .eq("household_id", householdId)
    .eq("visibility", "shared")
    .order("starts_at", { ascending: true });

  if (options?.from) {
    query = query.gte("ends_at", options.from);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) {
    return { events: [], error: error.message };
  }
  return { events: (data ?? []) as CalendarEvent[], error: null };
}

export type CalendarEventInput = {
  title: string;
  description?: string | null;
  starts_at: string;
  ends_at: string;
  all_day?: boolean;
  location?: string | null;
  event_type?: CalendarEventType;
  /** Create as private (default) or immediately propose to household. */
  visibility?: "private" | "pending";
};

export async function createCalendarEvent(
  supabase: SupabaseClient,
  args: {
    householdId: string;
    userId: string;
    input: CalendarEventInput;
  }
): Promise<{ event: CalendarEvent | null; error: string | null }> {
  const title = args.input.title.trim();
  if (!title) {
    return { event: null, error: "Title is required." };
  }
  if (new Date(args.input.ends_at) < new Date(args.input.starts_at)) {
    return { event: null, error: "End must be on or after start." };
  }

  const visibility: "private" | "pending" =
    args.input.visibility === "pending" ? "pending" : "private";
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("calendar_events")
    .insert({
      household_id: args.householdId,
      created_by: args.userId,
      title,
      description: args.input.description?.trim() || null,
      starts_at: args.input.starts_at,
      ends_at: args.input.ends_at,
      all_day: Boolean(args.input.all_day),
      location: args.input.location?.trim() || null,
      event_type: args.input.event_type ?? "other",
      visibility,
      proposed_at: visibility === "pending" ? now : null,
      proposed_by: visibility === "pending" ? args.userId : null,
      source: "manual",
    })
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { event: null, error: error.message };
  }
  return { event: data as CalendarEvent, error: null };
}

export async function updateCalendarEvent(
  supabase: SupabaseClient,
  eventId: string,
  input: Omit<CalendarEventInput, "visibility">
): Promise<{ event: CalendarEvent | null; error: string | null }> {
  const title = input.title.trim();
  if (!title) {
    return { event: null, error: "Title is required." };
  }
  if (new Date(input.ends_at) < new Date(input.starts_at)) {
    return { event: null, error: "End must be on or after start." };
  }

  const { data, error } = await supabase
    .from("calendar_events")
    .update({
      title,
      description: input.description?.trim() || null,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      all_day: Boolean(input.all_day),
      location: input.location?.trim() || null,
      event_type: input.event_type ?? "other",
    })
    .eq("id", eventId)
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { event: null, error: error.message };
  }
  return { event: data as CalendarEvent, error: null };
}

export async function deleteCalendarEvent(
  supabase: SupabaseClient,
  eventId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", eventId);
  return { error: error?.message ?? null };
}

/** Owner proposes a private event to the household (pending accept). */
export async function proposeCalendarEvent(
  supabase: SupabaseClient,
  eventId: string,
  userId: string
): Promise<{ event: CalendarEvent | null; error: string | null }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("calendar_events")
    .update({
      visibility: "pending",
      proposed_at: now,
      proposed_by: userId,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", eventId)
    .eq("created_by", userId)
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { event: null, error: error.message };
  }
  return { event: data as CalendarEvent, error: null };
}

/** Owner withdraws a pending proposal back to private. */
export async function cancelProposal(
  supabase: SupabaseClient,
  eventId: string,
  userId: string
): Promise<{ event: CalendarEvent | null; error: string | null }> {
  const { data, error } = await supabase
    .from("calendar_events")
    .update({
      visibility: "private",
      proposed_at: null,
      proposed_by: null,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", eventId)
    .eq("created_by", userId)
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { event: null, error: error.message };
  }
  return { event: data as CalendarEvent, error: null };
}

/** Household member accepts a pending proposal → shared (visible to all). */
export async function acceptCalendarEvent(
  supabase: SupabaseClient,
  eventId: string,
  userId: string
): Promise<{ event: CalendarEvent | null; error: string | null }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("calendar_events")
    .update({
      visibility: "shared",
      accepted_at: now,
      accepted_by: userId,
    })
    .eq("id", eventId)
    .eq("visibility", "pending")
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { event: null, error: error.message };
  }
  return { event: data as CalendarEvent, error: null };
}

/** Household member declines → back to private (co-parent sees nothing again). */
export async function declineCalendarEvent(
  supabase: SupabaseClient,
  eventId: string
): Promise<{ event: CalendarEvent | null; error: string | null }> {
  const { data, error } = await supabase
    .from("calendar_events")
    .update({
      visibility: "private",
      proposed_at: null,
      proposed_by: null,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", eventId)
    .eq("visibility", "pending")
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { event: null, error: error.message };
  }
  return { event: data as CalendarEvent, error: null };
}

/** Owner unshares a shared event → private again. */
export async function unshareCalendarEvent(
  supabase: SupabaseClient,
  eventId: string,
  userId: string
): Promise<{ event: CalendarEvent | null; error: string | null }> {
  const { data, error } = await supabase
    .from("calendar_events")
    .update({
      visibility: "private",
      proposed_at: null,
      proposed_by: null,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", eventId)
    .eq("created_by", userId)
    .select(SELECT_COLS)
    .single();

  if (error) {
    return { event: null, error: error.message };
  }
  return { event: data as CalendarEvent, error: null };
}

export async function listPersonalCalendarConnections(
  supabase: SupabaseClient,
  userId: string
): Promise<{ connections: PersonalCalendarConnection[]; error: string | null }> {
  const { data, error } = await supabase
    .from("personal_calendar_connections")
    .select(
      "id, user_id, provider, status, external_account_email, external_calendar_id, last_synced_at, created_at, updated_at"
    )
    .eq("user_id", userId)
    .order("provider");

  if (error) {
    return { connections: [], error: error.message };
  }
  return {
    connections: (data ?? []) as PersonalCalendarConnection[],
    error: null,
  };
}

/** Events visible on the user's month grid: own private/pending + all shared. */
export function eventsForMonthGrid(
  events: CalendarEvent[],
  userId: string
): CalendarEvent[] {
  return events.filter(
    (e) =>
      e.visibility === "shared" ||
      (e.created_by === userId &&
        (e.visibility === "private" || e.visibility === "pending"))
  );
}

/** Pending proposals from others awaiting this user's accept/decline. */
export function incomingShareRequests(
  events: CalendarEvent[],
  userId: string
): CalendarEvent[] {
  return events.filter(
    (e) => e.visibility === "pending" && e.created_by !== userId
  );
}

/** Map shared DB rows to reference-picker / tone-context shape. */
export function eventsToPickerItems(events: CalendarEvent[]) {
  return events
    .filter((e) => e.visibility === "shared")
    .map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      location: e.location,
    }));
}
