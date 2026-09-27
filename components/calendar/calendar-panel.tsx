"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPES,
  acceptCalendarEvent,
  cancelProposal,
  createCalendarEvent,
  declineCalendarEvent,
  deleteCalendarEvent,
  eventsForMonthGrid,
  incomingShareRequests,
  listCalendarEvents,
  listPersonalCalendarConnections,
  proposeCalendarEvent,
  unshareCalendarEvent,
  updateCalendarEvent,
} from "@/lib/calendar";
import type {
  CalendarEvent,
  CalendarEventType,
  CalendarVisibility,
  PersonalCalendarConnection,
} from "@/lib/types";
import { ConnectedCalendars } from "@/components/calendar/connected-calendars";
import {
  EventDateTimeFields,
  defaultPartsForDay,
  partsFromEvent,
  partsToIso,
  validateParts,
  type DateTimeParts,
} from "@/components/calendar/event-datetime-fields";
import { LocationInput } from "@/components/calendar/location-input";

type Props = {
  householdId: string;
  householdName: string;
  userId: string;
  initialEvents: CalendarEvent[];
  initialConnections: PersonalCalendarConnection[];
  googlePick?: boolean;
  googleUpgraded?: boolean;
  googleError?: string | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

const secondaryBtn =
  "inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50";

const primaryBtn =
  "inline-flex items-center justify-center rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

const ghostBtn =
  "inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50";

/** Left accent by event type; fill driven by visibility */
const TYPE_ACCENT: Record<CalendarEventType, string> = {
  parenting_time: "border-l-[#1d4ed8]",
  school: "border-l-[#7c3aed]",
  medical: "border-l-[#dc2626]",
  activity: "border-l-[#059669]",
  other: "border-l-[#64748b]",
};

function chipClass(visibility: CalendarVisibility, eventType: CalendarEventType): string {
  const accent = TYPE_ACCENT[eventType] ?? TYPE_ACCENT.other;
  if (visibility === "shared") {
    // Shared fill is blue; type accent still shows as a left stripe via accent color
    return `border-l-2 ${accent} bg-accent text-white`;
  }
  if (visibility === "pending") {
    return `border-l-2 ${accent} bg-amber-100 text-amber-900 ring-1 ring-amber-200/80`;
  }
  return `border-l-2 ${accent} bg-slate-100/90 text-slate-600 ring-1 ring-slate-200/70`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDay(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatMonthTitle(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatEventWhen(event: CalendarEvent): string {
  try {
    if (event.all_day) {
      const start = new Date(event.starts_at).toLocaleDateString(undefined, {
        dateStyle: "medium",
      });
      const end = new Date(event.ends_at).toLocaleDateString(undefined, {
        dateStyle: "medium",
      });
      return start === end ? `${start} · All day` : `${start} – ${end} · All day`;
    }
    return `${new Date(event.starts_at).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    })} – ${new Date(event.ends_at).toLocaleString(undefined, {
      timeStyle: "short",
    })}`;
  } catch {
    return event.starts_at;
  }
}

function formatChipTime(event: CalendarEvent): string {
  if (event.all_day) return "";
  try {
    return new Date(event.starts_at).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type FormState = {
  title: string;
  description: string;
  when: DateTimeParts;
  location: string;
  eventType: CalendarEventType;
  proposeOnCreate: boolean;
};

function emptyForm(day?: Date): FormState {
  const base = day ?? new Date();
  return {
    title: "",
    description: "",
    when: defaultPartsForDay(base),
    location: "",
    eventType: "parenting_time",
    proposeOnCreate: false,
  };
}

function formFromEvent(event: CalendarEvent): FormState {
  return {
    title: event.title,
    description: event.description ?? "",
    when: partsFromEvent(event.starts_at, event.ends_at, event.all_day),
    location: event.location ?? "",
    eventType: event.event_type,
    proposeOnCreate: false,
  };
}

function visibilityBadge(event: CalendarEvent, userId: string): {
  label: string;
  className: string;
} {
  if (event.visibility === "shared") {
    return { label: "Shared", className: "bg-accent-soft text-accent" };
  }
  if (event.visibility === "pending") {
    return {
      label: event.created_by === userId ? "Pending accept" : "Needs your accept",
      className: "bg-warning-soft text-warning",
    };
  }
  return {
    label: "Private",
    className: "bg-surface text-muted ring-1 ring-border",
  };
}

function buildMonthCells(month: Date): Array<{ date: Date; inMonth: boolean }> {
  const first = startOfMonth(month);
  const startPad = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startPad);
  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    cells.push({
      date,
      inMonth: date.getMonth() === month.getMonth(),
    });
  }
  return cells;
}

function EmptyIllustration({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface ring-1 ring-border">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          className="text-muted-foreground"
          aria-hidden
        >
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 3v4M16 3v4" />
        </svg>
      </div>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-surface ring-1 ring-border/60 ${className ?? ""}`}
    />
  );
}

export function CalendarPanel({
  householdId,
  householdName,
  userId,
  initialEvents,
  initialConnections,
  googlePick = false,
  googleUpgraded = false,
  googleError = null,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [connections, setConnections] =
    useState<PersonalCalendarConnection[]>(initialConnections);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [{ events: next, error: evErr }, { connections: conns }] =
      await Promise.all([
        listCalendarEvents(supabase, householdId),
        listPersonalCalendarConnections(supabase, userId),
      ]);
    if (evErr) {
      setError(evErr);
      setRefreshing(false);
      return;
    }
    setEvents(next);
    setConnections(conns);
    setRefreshing(false);
  }, [householdId, supabase, userId]);

  useEffect(() => {
    const channel = supabase
      .channel(`calendar_events:${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_events",
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

  const gridEvents = useMemo(
    () => eventsForMonthGrid(events, userId),
    [events, userId]
  );

  const incoming = useMemo(
    () => incomingShareRequests(events, userId),
    [events, userId]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of gridEvents) {
      const start = parseLocalDay(event.starts_at);
      const end = parseLocalDay(event.ends_at);
      const cursor = new Date(start);
      while (cursor.getTime() <= end.getTime()) {
        const key = dateKey(cursor);
        const list = map.get(key) ?? [];
        list.push(event);
        map.set(key, list);
        cursor.setDate(cursor.getDate() + 1);
        if (cursor.getTime() - start.getTime() > 1000 * 60 * 60 * 24 * 40) break;
      }
    }
    return map;
  }, [gridEvents]);

  const dayEvents = useMemo(() => {
    const key = dateKey(selectedDay);
    return (eventsByDay.get(key) ?? []).slice().sort((a, b) =>
      a.starts_at.localeCompare(b.starts_at)
    );
  }, [eventsByDay, selectedDay]);

  const upcomingShared = useMemo(() => {
    const now = new Date().toISOString();
    return gridEvents
      .filter((e) => e.visibility === "shared" && e.ends_at >= now)
      .slice(0, 8);
  }, [gridEvents]);

  const myPrivateUpcoming = useMemo(() => {
    const now = new Date().toISOString();
    return gridEvents
      .filter(
        (e) =>
          e.created_by === userId &&
          e.visibility === "private" &&
          e.ends_at >= now
      )
      .slice(0, 5);
  }, [gridEvents, userId]);

  const cells = useMemo(() => buildMonthCells(month), [month]);
  const today = useMemo(() => new Date(), []);

  function goToday() {
    const t = new Date();
    setMonth(startOfMonth(t));
    setSelectedDay(t);
  }

  function openCreate(day?: Date) {
    const d = day ?? selectedDay;
    setSelectedDay(d);
    setEditingId(null);
    setForm(emptyForm(d));
    setEditorOpen(true);
    setError(null);
  }

  function openEdit(event: CalendarEvent) {
    if (event.created_by !== userId) return;
    setEditingId(event.id);
    setForm(formFromEvent(event));
    setEditorOpen(true);
    setError(null);
  }

  function onDayClick(date: Date) {
    const already = sameDay(date, selectedDay);
    setSelectedDay(date);
    // Second click on the same day opens create with that date prefilled
    if (already) openCreate(date);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const whenErr = validateParts(form.when);
    if (whenErr) {
      setError(whenErr);
      setBusy(false);
      return;
    }
    const { starts_at, ends_at } = partsToIso(form.when);
    const input = {
      title: form.title,
      description: form.description || null,
      starts_at,
      ends_at,
      all_day: form.when.allDay,
      location: form.location || null,
      event_type: form.eventType,
    };

    if (editingId) {
      const { error: updErr } = await updateCalendarEvent(
        supabase,
        editingId,
        input
      );
      if (updErr) {
        setError(updErr);
        setBusy(false);
        return;
      }
      void fetch("/api/calendar/google/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: editingId, action: "upsert" }),
      });
    } else {
      const { event: created, error: createErr } = await createCalendarEvent(
        supabase,
        {
          householdId,
          userId,
          input: {
            ...input,
            visibility: form.proposeOnCreate ? "pending" : "private",
          },
        }
      );
      if (createErr) {
        setError(createErr);
        setBusy(false);
        return;
      }
      if (created?.id) {
        void fetch("/api/calendar/google/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: created.id, action: "upsert" }),
        });
      }
    }

    setEditorOpen(false);
    setEditingId(null);
    setBusy(false);
    await refresh();
  }

  async function onDelete(eventId: string) {
    if (busy) return;
    if (!window.confirm("Delete this event? This cannot be undone.")) return;
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/calendar/google/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, action: "delete" }),
      });
    } catch {
      // best-effort Google delete
    }
    const { error: delErr } = await deleteCalendarEvent(supabase, eventId);
    if (delErr) setError(delErr);
    setBusy(false);
    setEditorOpen(false);
    setEditingId(null);
    await refresh();
  }

  async function onPropose(eventId: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await proposeCalendarEvent(supabase, eventId, userId);
    if (err) setError(err);
    setBusy(false);
    await refresh();
  }

  async function onCancelProposal(eventId: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await cancelProposal(supabase, eventId, userId);
    if (err) setError(err);
    setBusy(false);
    await refresh();
  }

  async function onAccept(eventId: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await acceptCalendarEvent(supabase, eventId, userId);
    if (err) setError(err);
    setBusy(false);
    await refresh();
  }

  async function onDecline(eventId: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await declineCalendarEvent(supabase, eventId);
    if (err) setError(err);
    setBusy(false);
    await refresh();
  }

  async function onUnshare(eventId: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await unshareCalendarEvent(supabase, eventId, userId);
    if (err) setError(err);
    setBusy(false);
    await refresh();
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Calendar
            </h1>
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
              Live
            </span>
            {refreshing ? (
              <span className="text-[11px] font-medium text-muted">Updating…</span>
            ) : null}
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted sm:text-base sm:leading-7">
            Shared custody calendar for{" "}
            <span className="font-semibold text-foreground">{householdName}</span>
            . Private events stay visible only to you until the co-parent
            accepts a share proposal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={
              connections.some((c) => c.provider === "google" && c.status === "connected")
                ? "#connected-calendars"
                : "/api/calendar/google/connect"
            }
            className={secondaryBtn}
          >
            {connections.some((c) => c.provider === "google" && c.status === "connected")
              ? "Manage calendars"
              : "Connect Google"}
          </a>
          <button type="button" className={primaryBtn} onClick={() => openCreate()}>
            New event
          </button>
        </div>
      </div>

      <ConnectedCalendars
        connections={connections}
        onChanged={refresh}
        autoOpenPicker={googlePick}
        googleUpgraded={googleUpgraded}
        flashError={googleError}
      />

      {error ? (
        <p
          className="rounded-2xl border border-red-200 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {incoming.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-br from-warning-soft to-card shadow-[var(--shadow-sm)]">
          <div className="border-b border-amber-200/60 px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-warning">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                </svg>
              </span>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Share requests
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-warning">
                    {incoming.length}
                  </span>
                </h2>
                <p className="text-xs text-muted">
                  Accept to share with the parenting team, or decline to leave private for the other parent.
                </p>
              </div>
            </div>
          </div>
          <ul className="divide-y divide-amber-100/80">
            {incoming.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-start justify-between gap-3 bg-card/80 px-4 py-3.5 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{event.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatEventWhen(event)}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-muted">
                    {EVENT_TYPE_LABELS[event.event_type]}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    className={primaryBtn}
                    disabled={busy}
                    onClick={() => void onAccept(event.id)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={busy}
                    onClick={() => void onDecline(event.id)}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(16rem,0.7fr)] lg:gap-5">
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-md)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={ghostBtn}
                onClick={() => setMonth((m) => addMonths(m, -1))}
                aria-label="Previous month"
              >
                ‹
              </button>
              <h2 className="min-w-[9.5rem] text-center text-base font-semibold tracking-tight text-foreground sm:min-w-[11rem] sm:text-lg">
                {formatMonthTitle(month)}
              </h2>
              <button
                type="button"
                className={ghostBtn}
                onClick={() => setMonth((m) => addMonths(m, 1))}
                aria-label="Next month"
              >
                ›
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className={secondaryBtn} onClick={goToday}>
                Today
              </button>
              <button
                type="button"
                className={primaryBtn}
                onClick={() => openCreate(selectedDay)}
              >
                + Add
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-border bg-surface/80 text-center text-[10px] font-semibold uppercase tracking-wider text-muted sm:text-[11px]">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-0.5 py-1.5 sm:py-2">
                <span className="sm:hidden">{d.slice(0, 1)}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>

          {refreshing && events.length === 0 ? (
            <div className="grid grid-cols-7">
              {Array.from({ length: 35 }).map((_, i) => (
                <div
                  key={i}
                  className="min-h-[4.25rem] border-b border-r border-border p-1.5 sm:min-h-[5.25rem]"
                >
                  <SkeletonBlock className="mb-1 h-5 w-5 rounded-full" />
                  <SkeletonBlock className="mb-0.5 h-3 w-full" />
                  <SkeletonBlock className="h-3 w-[75%]" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {cells.map(({ date, inMonth }) => {
                const key = dateKey(date);
                const list = eventsByDay.get(key) ?? [];
                const selected = sameDay(date, selectedDay);
                const isToday = sameDay(date, today);
                const overflow = list.length - MAX_CHIPS;
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => onDayClick(date)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      openCreate(date);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onDayClick(date);
                      }
                    }}
                    className={`group relative min-h-[4.25rem] cursor-pointer border-b border-r border-border p-1 text-left transition-colors sm:min-h-[5.5rem] sm:p-1.5 ${
                      selected
                        ? "bg-accent-soft/50 ring-1 ring-inset ring-accent/30"
                        : inMonth
                          ? "bg-card hover:bg-surface/70"
                          : "bg-background/80 text-muted-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-0.5">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold sm:h-7 sm:w-7 sm:text-xs ${
                          isToday
                            ? "bg-accent text-white shadow-[var(--shadow-sm)]"
                            : selected
                              ? "font-bold text-accent"
                              : inMonth
                                ? "text-foreground"
                                : "text-muted-foreground"
                        }`}
                      >
                        {date.getDate()}
                      </span>
                      <button
                        type="button"
                        aria-label={`Add event on ${key}`}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-muted opacity-0 transition-opacity hover:bg-accent-soft hover:text-accent group-hover:opacity-100 focus:opacity-100 sm:h-6 sm:w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCreate(date);
                        }}
                      >
                        <span className="text-sm font-bold leading-none">+</span>
                      </button>
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {list.slice(0, MAX_CHIPS).map((ev) => {
                        const t = formatChipTime(ev);
                        return (
                          <div
                            key={ev.id}
                            className={`truncate rounded px-1 py-px text-[9px] font-semibold leading-4 sm:text-[10px] sm:leading-[1.15rem] ${chipClass(
                              ev.visibility,
                              ev.event_type
                            )}`}
                            title={`${ev.title} · ${visibilityBadge(ev, userId).label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDay(date);
                              if (ev.created_by === userId) openEdit(ev);
                            }}
                          >
                            {t ? (
                              <span className="mr-0.5 font-medium opacity-80">{t}</span>
                            ) : null}
                            {ev.title}
                          </div>
                        );
                      })}
                      {overflow > 0 ? (
                        <button
                          type="button"
                          className="w-full truncate rounded px-1 py-px text-left text-[9px] font-semibold text-muted hover:bg-surface sm:text-[10px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDay(date);
                          }}
                        >
                          +{overflow} more
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-surface/50 px-3 py-2 text-[10px] text-muted sm:px-4 sm:text-[11px]">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-accent" /> Shared
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-amber-300" /> Pending
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-slate-300" /> Private
            </span>
            <span className="hidden sm:inline">·</span>
            <span className="w-full sm:w-auto">
              Click a day to select; click again or + to create with that date. Private stays off the co-parent&apos;s view until accepted.
            </span>
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground sm:text-base">
                {selectedDay.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </h2>
              <button
                type="button"
                className={secondaryBtn}
                onClick={() => openCreate(selectedDay)}
              >
                Add
              </button>
            </div>
            {dayEvents.length === 0 ? (
              <EmptyIllustration label="No events on this day. Click Add to create one." />
            ) : (
              <ul className="mt-3 space-y-2">
                {dayEvents.map((event) => {
                  const badge = visibilityBadge(event, userId);
                  const mine = event.created_by === userId;
                  return (
                    <li
                      key={event.id}
                      className={`rounded-xl border border-border bg-background px-3 py-2.5 sm:px-3.5 sm:py-3 border-l-[3px] ${
                        event.visibility === "shared"
                          ? "border-l-accent"
                          : event.visibility === "pending"
                            ? "border-l-warning"
                            : "border-l-slate-300"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">
                            {event.title}
                            {event.source === "google" ? (
                              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                Google
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-muted">
                            {formatEventWhen(event)}
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            {EVENT_TYPE_LABELS[event.event_type]}
                            {event.location ? ` · ${event.location}` : ""}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {mine ? (
                          <>
                            <button
                              type="button"
                              className={secondaryBtn}
                              disabled={busy}
                              onClick={() => openEdit(event)}
                            >
                              Edit
                            </button>
                            {event.visibility === "private" ? (
                              <button
                                type="button"
                                className={primaryBtn}
                                disabled={busy}
                                onClick={() => void onPropose(event.id)}
                              >
                                Propose to parenting team
                              </button>
                            ) : null}
                            {event.visibility === "pending" ? (
                              <>
                                <button
                                  type="button"
                                  className={primaryBtn}
                                  disabled={busy}
                                  onClick={() => void onAccept(event.id)}
                                  title="Confirm as shared (solo parenting team or after verbal agreement)"
                                >
                                  Confirm shared
                                </button>
                                <button
                                  type="button"
                                  className={secondaryBtn}
                                  disabled={busy}
                                  onClick={() => void onCancelProposal(event.id)}
                                >
                                  Cancel proposal
                                </button>
                              </>
                            ) : null}
                            {event.visibility === "shared" ? (
                              <button
                                type="button"
                                className={secondaryBtn}
                                disabled={busy}
                                onClick={() => void onUnshare(event.id)}
                              >
                                Make private
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={secondaryBtn}
                              disabled={busy}
                              onClick={() => void onDelete(event.id)}
                            >
                              Delete
                            </button>
                          </>
                        ) : event.visibility === "pending" ? (
                          <>
                            <button
                              type="button"
                              className={primaryBtn}
                              disabled={busy}
                              onClick={() => void onAccept(event.id)}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              className={secondaryBtn}
                              disabled={busy}
                              onClick={() => void onDecline(event.id)}
                            >
                              Decline
                            </button>
                          </>
                        ) : (
                          <p className="text-xs text-muted">Shared by co-parent</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] sm:p-5">
            <h2 className="text-sm font-semibold text-foreground sm:text-base">
              Upcoming shared
            </h2>
            {upcomingShared.length === 0 ? (
              <EmptyIllustration label="No shared events yet. Create one, propose it, and have the co-parent accept." />
            ) : (
              <ul className="mt-3 space-y-2">
                {upcomingShared.map((event) => (
                  <li key={event.id} className="flex gap-2 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{event.title}</p>
                      <p className="text-xs text-muted">{formatEventWhen(event)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {myPrivateUpcoming.length > 0 ? (
            <section className="rounded-2xl border border-dashed border-border bg-surface/80 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-foreground sm:text-base">
                Your private upcoming
              </h2>
              <p className="mt-1 text-xs text-muted">
                Only you can see these until a proposal is accepted.
              </p>
              <ul className="mt-3 space-y-2">
                {myPrivateUpcoming.map((event) => (
                  <li key={event.id} className="flex gap-2 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{event.title}</p>
                      <p className="text-xs text-muted">{formatEventWhen(event)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      {editorOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-editor-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-foreground/40 backdrop-blur-[1px]"
            aria-label="Close editor"
            disabled={busy}
            onClick={() => setEditorOpen(false)}
          />
          <form
            onSubmit={(e) => void onSubmit(e)}
            className="relative z-10 max-h-[min(92vh,760px)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-card shadow-[var(--shadow-lg)] sm:mx-4 sm:rounded-2xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card/95 px-4 py-3.5 backdrop-blur sm:px-5">
              <div className="min-w-0">
                <h2
                  id="event-editor-title"
                  className="text-lg font-semibold tracking-tight text-foreground sm:text-xl"
                >
                  {editingId ? "Edit event" : "New event"}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  {editingId
                    ? "Changes keep the current visibility."
                    : "Starts private. Propose only when you want co-parent review."}
                </p>
              </div>
              <button
                type="button"
                className={ghostBtn}
                disabled={busy}
                onClick={() => setEditorOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Title
                </span>
                <input
                  required
                  maxLength={200}
                  value={form.title}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                  placeholder="e.g. Parenting time exchange"
                  autoFocus
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 sm:col-span-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Type
                  </span>
                  <select
                    value={form.eventType}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        eventType: e.target.value as CalendarEventType,
                      }))
                    }
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {EVENT_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Location
                  </span>
                  <LocationInput
                    value={form.location}
                    disabled={busy}
                    onChange={(location) => setForm((f) => ({ ...f, location }))}
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface/50 p-3 sm:p-3.5">
                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  When
                </p>
                <EventDateTimeFields
                  value={form.when}
                  disabled={busy}
                  onChange={(when) => setForm((f) => ({ ...f, when }))}
                />
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Description
                </span>
                <textarea
                  maxLength={5000}
                  rows={2}
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  className="w-full resize-y rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                  placeholder="Optional notes for yourself or the parenting team"
                />
              </label>

              {!editingId ? (
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Visibility
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setForm((f) => ({ ...f, proposeOnCreate: false }))
                      }
                      className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                        !form.proposeOnCreate
                          ? "border-accent bg-accent-soft/50 ring-1 ring-accent/30"
                          : "border-border bg-background hover:bg-surface"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-foreground">
                        Private
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                        Only you can see this. Co-parent sees nothing until you propose.
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setForm((f) => ({ ...f, proposeOnCreate: true }))
                      }
                      className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                        form.proposeOnCreate
                          ? "border-amber-400 bg-warning-soft ring-1 ring-amber-300/50"
                          : "border-border bg-background hover:bg-surface"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-foreground">
                        Propose
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                        Sends a share request. Shared only after they accept — never automatic.
                      </span>
                    </button>
                  </div>
                </fieldset>
              ) : null}
            </div>

            <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-5">
              {editingId ? (
                <button
                  type="button"
                  className={secondaryBtn}
                  disabled={busy}
                  onClick={() => void onDelete(editingId)}
                >
                  Delete
                </button>
              ) : null}
              <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setEditorOpen(false)}>
                Cancel
              </button>
              <button type="submit" className={primaryBtn} disabled={busy}>
                {busy ? "Saving…" : editingId ? "Save changes" : "Create event"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
