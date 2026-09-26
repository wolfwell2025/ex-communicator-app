"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPES,
  VISIBILITY_LABELS,
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
  PersonalCalendarConnection,
} from "@/lib/types";

type Props = {
  householdId: string;
  householdName: string;
  userId: string;
  initialEvents: CalendarEvent[];
  initialConnections: PersonalCalendarConnection[];
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const secondaryBtn =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50";

const primaryBtn =
  "inline-flex items-center justify-center rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

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

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string {
  const d = new Date(value);
  return d.toISOString();
}

function defaultRangeForDay(day: Date): { starts: string; ends: string } {
  const start = new Date(day);
  start.setHours(9, 0, 0, 0);
  const end = new Date(day);
  end.setHours(10, 0, 0, 0);
  return { starts: toLocalInputValue(start.toISOString()), ends: toLocalInputValue(end.toISOString()) };
}

type FormState = {
  title: string;
  description: string;
  startsLocal: string;
  endsLocal: string;
  allDay: boolean;
  location: string;
  eventType: CalendarEventType;
  proposeOnCreate: boolean;
};

function emptyForm(day?: Date): FormState {
  const base = day ?? new Date();
  const range = defaultRangeForDay(base);
  return {
    title: "",
    description: "",
    startsLocal: range.starts,
    endsLocal: range.ends,
    allDay: false,
    location: "",
    eventType: "parenting_time",
    proposeOnCreate: false,
  };
}

function formFromEvent(event: CalendarEvent): FormState {
  return {
    title: event.title,
    description: event.description ?? "",
    startsLocal: toLocalInputValue(event.starts_at),
    endsLocal: toLocalInputValue(event.ends_at),
    allDay: event.all_day,
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
    return {
      label: "Shared",
      className: "bg-accent-soft text-accent",
    };
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

export function CalendarPanel({
  householdId,
  householdName,
  userId,
  initialEvents,
  initialConnections,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [connections, setConnections] =
    useState<PersonalCalendarConnection[]>(initialConnections);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [connectNote, setConnectNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [{ events: next, error: evErr }, { connections: conns }] =
      await Promise.all([
        listCalendarEvents(supabase, householdId),
        listPersonalCalendarConnections(supabase, userId),
      ]);
    if (evErr) {
      setError(evErr);
      return;
    }
    setEvents(next);
    setConnections(conns);
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const input = {
      title: form.title,
      description: form.description || null,
      starts_at: localInputToIso(form.startsLocal),
      ends_at: localInputToIso(form.endsLocal),
      all_day: form.allDay,
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
    } else {
      const { error: createErr } = await createCalendarEvent(supabase, {
        householdId,
        userId,
        input: {
          ...input,
          visibility: form.proposeOnCreate ? "pending" : "private",
        },
      });
      if (createErr) {
        setError(createErr);
        setBusy(false);
        return;
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

  function onConnectStub(provider: "google" | "apple" | "outlook") {
    setConnectNote(
      `${provider === "google" ? "Google" : provider === "apple" ? "Apple" : "Outlook"} Calendar sync is not wired yet. Schema is ready (personal_calendar_connections); OAuth will land in a later slice. Private events you add here stay private until you propose and the co-parent accepts.`
    );
  }

  const googleConn = connections.find((c) => c.provider === "google");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              Calendar
            </h1>
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
              Live
            </span>
          </div>
          <p className="max-w-2xl text-base leading-7 text-muted">
            Shared custody calendar for{" "}
            <span className="font-semibold text-foreground">{householdName}</span>
            . Private events stay visible only to you until the co-parent
            accepts a share proposal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => onConnectStub("google")}
            title="OAuth sync coming later"
          >
            {googleConn?.status === "connected"
              ? "Google Calendar connected"
              : "Connect personal calendar"}
          </button>
          <button type="button" className={primaryBtn} onClick={() => openCreate()}>
            New event
          </button>
        </div>
      </div>

      {connectNote ? (
        <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
          {connectNote}
          <button
            type="button"
            className="ml-2 font-semibold text-accent hover:underline"
            onClick={() => setConnectNote(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <p
          className="rounded-2xl border border-red-200 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {incoming.length > 0 ? (
        <section className="rounded-3xl border border-amber-200 bg-warning-soft p-5 shadow-[var(--shadow-sm)]">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-warning">
            Share requests
          </h2>
          <p className="mt-1 text-sm text-muted">
            These proposed events are not on the shared calendar yet. Accept to
            make them visible to the household, or decline to leave them private
            for the other parent only.
          </p>
          <ul className="mt-4 space-y-3">
            {incoming.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{event.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatEventWhen(event)} · {EVENT_TYPE_LABELS[event.event_type]}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-lg)]">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => setMonth((m) => addMonths(m, -1))}
              aria-label="Previous month"
            >
              ←
            </button>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {formatMonthTitle(month)}
            </h2>
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => setMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
            >
              →
            </button>
          </div>
          <div className="grid grid-cols-7 border-b border-border bg-surface text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-1 py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map(({ date, inMonth }) => {
              const key = dateKey(date);
              const list = eventsByDay.get(key) ?? [];
              const selected = sameDay(date, selectedDay);
              const isToday = sameDay(date, today);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(date)}
                  onDoubleClick={() => openCreate(date)}
                  className={`min-h-[5.5rem] border-b border-r border-border p-1.5 text-left transition-colors sm:min-h-[6.5rem] ${
                    selected
                      ? "bg-accent-soft/60"
                      : inMonth
                        ? "bg-card hover:bg-surface"
                        : "bg-background text-muted-foreground"
                  }`}
                >
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                      isToday
                        ? "bg-accent text-white"
                        : selected
                          ? "text-accent"
                          : "text-foreground"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {list.slice(0, 3).map((ev) => {
                      const badge = visibilityBadge(ev, userId);
                      return (
                        <div
                          key={ev.id}
                          className={`truncate rounded-md px-1 py-0.5 text-[10px] font-semibold ${
                            ev.visibility === "shared"
                              ? "bg-accent text-white"
                              : ev.visibility === "pending"
                                ? "bg-warning-soft text-warning"
                                : "bg-surface text-muted ring-1 ring-border"
                          }`}
                          title={`${ev.title} · ${badge.label}`}
                        >
                          {ev.title}
                        </div>
                      );
                    })}
                    {list.length > 3 ? (
                      <p className="text-[10px] font-medium text-muted">
                        +{list.length - 3} more
                      </p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="border-t border-border px-4 py-2.5 text-xs text-muted sm:px-5">
            Double-click a day to add an event. Private chips stay off the
            co-parent&apos;s view until they accept a proposal.
          </p>
        </section>

        <div className="space-y-5">
          <section className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">
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
              <p className="mt-3 text-sm text-muted">No events on this day.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {dayEvents.map((event) => {
                  const badge = visibilityBadge(event, userId);
                  const mine = event.created_by === userId;
                  return (
                    <li
                      key={event.id}
                      className="rounded-2xl border border-border bg-background px-3.5 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">
                            {event.title}
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
                                Propose to household
                              </button>
                            ) : null}
                            {event.visibility === "pending" ? (
                              <>
                                <button
                                  type="button"
                                  className={primaryBtn}
                                  disabled={busy}
                                  onClick={() => void onAccept(event.id)}
                                  title="Confirm as shared (solo household or after verbal agreement)"
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
                          <p className="text-xs text-muted">
                            Shared by co-parent
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
            <h2 className="text-base font-semibold text-foreground">
              Upcoming shared
            </h2>
            {upcomingShared.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                No shared events yet. Create a parenting-time event, propose it,
                and have the co-parent accept.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {upcomingShared.map((event) => (
                  <li key={event.id} className="text-sm">
                    <p className="font-semibold text-foreground">{event.title}</p>
                    <p className="text-xs text-muted">{formatEventWhen(event)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {myPrivateUpcoming.length > 0 ? (
            <section className="rounded-3xl border border-dashed border-border bg-surface p-5">
              <h2 className="text-base font-semibold text-foreground">
                Your private upcoming
              </h2>
              <p className="mt-1 text-xs text-muted">
                Only you can see these. Co-parent sees nothing until they accept
                a proposal.
              </p>
              <ul className="mt-3 space-y-2">
                {myPrivateUpcoming.map((event) => (
                  <li key={event.id} className="text-sm">
                    <p className="font-semibold text-foreground">{event.title}</p>
                    <p className="text-xs text-muted">{formatEventWhen(event)}</p>
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
            className="relative z-10 max-h-[min(92vh,720px)] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-[var(--shadow-lg)] sm:mx-4 sm:rounded-3xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="event-editor-title"
                  className="text-xl font-semibold tracking-tight text-foreground"
                >
                  {editingId ? "Edit event" : "New event"}
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted">
                  New events start private. Propose to household when you want
                  the co-parent to review and accept.
                </p>
              </div>
              <button
                type="button"
                className={secondaryBtn}
                disabled={busy}
                onClick={() => setEditorOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
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
                />
              </label>

              <label className="block space-y-1.5">
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

              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={form.allDay}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, allDay: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-border"
                />
                All-day event
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Starts
                  </span>
                  <input
                    required
                    type="datetime-local"
                    value={form.startsLocal}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, startsLocal: e.target.value }))
                    }
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Ends
                  </span>
                  <input
                    required
                    type="datetime-local"
                    value={form.endsLocal}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, endsLocal: e.target.value }))
                    }
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Location
                </span>
                <input
                  maxLength={300}
                  value={form.location}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, location: e.target.value }))
                  }
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                  placeholder="Optional"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Description
                </span>
                <textarea
                  maxLength={5000}
                  rows={3}
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  className="w-full resize-y rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                  placeholder="Optional notes"
                />
              </label>

              {!editingId ? (
                <label className="flex items-start gap-2.5 rounded-2xl border border-border bg-surface px-3.5 py-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={form.proposeOnCreate}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        proposeOnCreate: e.target.checked,
                      }))
                    }
                    className="mt-0.5 h-4 w-4 rounded border-border"
                  />
                  <span>
                    <span className="font-semibold">Propose to household now</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted">
                      Starts as {VISIBILITY_LABELS.pending}. Co-parent must
                      accept before it appears on the shared calendar. Leave
                      unchecked to keep it {VISIBILITY_LABELS.private}.
                    </span>
                  </span>
                </label>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
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
