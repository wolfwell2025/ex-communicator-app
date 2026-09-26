"use client";

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]";

export type DateTimeParts = {
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endDate: string;
  endTime: string;
  allDay: boolean;
};

/** 15-minute time options like Google Calendar */
export function buildTimeOptions(): string[] {
  const opts: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      opts.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return opts;
}

const TIME_OPTIONS = buildTimeOptions();

export function padTime(t: string): string {
  const [h, m] = t.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "09:00";
  const nearest = Math.round(m / 15) * 15;
  const mm = nearest === 60 ? 0 : nearest;
  const hh = nearest === 60 ? (h + 1) % 24 : h;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function dateFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "09:00";
  return padTime(
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  );
}

export function partsToIso(parts: DateTimeParts): {
  starts_at: string;
  ends_at: string;
} {
  if (parts.allDay) {
    const start = new Date(`${parts.startDate}T00:00:00`);
    const end = new Date(`${parts.endDate}T23:59:59`);
    return { starts_at: start.toISOString(), ends_at: end.toISOString() };
  }
  const start = new Date(`${parts.startDate}T${parts.startTime}:00`);
  const end = new Date(`${parts.endDate}T${parts.endTime}:00`);
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

export function validateParts(parts: DateTimeParts): string | null {
  if (!parts.startDate || !parts.endDate) return "Start and end dates are required.";
  const { starts_at, ends_at } = partsToIso(parts);
  if (Number.isNaN(new Date(starts_at).getTime())) return "Invalid start date/time.";
  if (Number.isNaN(new Date(ends_at).getTime())) return "Invalid end date/time.";
  if (new Date(ends_at) < new Date(starts_at)) {
    return "End must be after start.";
  }
  return null;
}

function addHours(date: string, time: string, hours: number): {
  date: string;
  time: string;
} {
  const d = new Date(`${date}T${time}:00`);
  d.setHours(d.getHours() + hours);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: padTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`),
  };
}

function formatTimeLabel(t: string): string {
  const [hStr, mStr] = t.split(":");
  let h = Number(hStr);
  const m = mStr;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

type Props = {
  value: DateTimeParts;
  onChange: (next: DateTimeParts) => void;
  disabled?: boolean;
};

export function EventDateTimeFields({ value, onChange, disabled }: Props) {
  function setStartDate(startDate: string) {
    const next = { ...value, startDate };
    // Keep end on/after start; preserve duration when possible
    if (value.allDay) {
      if (next.endDate < startDate) next.endDate = startDate;
    } else {
      const startMs = new Date(`${startDate}T${value.startTime}:00`).getTime();
      const endMs = new Date(`${value.endDate}T${value.endTime}:00`).getTime();
      if (endMs <= startMs) {
        const bumped = addHours(startDate, value.startTime, 1);
        next.endDate = bumped.date;
        next.endTime = bumped.time;
      }
    }
    onChange(next);
  }

  function setStartTime(startTime: string) {
    const t = padTime(startTime);
    const next = { ...value, startTime: t };
    const startMs = new Date(`${value.startDate}T${t}:00`).getTime();
    const endMs = new Date(`${value.endDate}T${value.endTime}:00`).getTime();
    if (endMs <= startMs) {
      const bumped = addHours(value.startDate, t, 1);
      next.endDate = bumped.date;
      next.endTime = bumped.time;
    }
    onChange(next);
  }

  function setEndDate(endDate: string) {
    onChange({ ...value, endDate });
  }

  function setEndTime(endTime: string) {
    onChange({ ...value, endTime: padTime(endTime) });
  }

  function setAllDay(allDay: boolean) {
    if (allDay) {
      onChange({
        ...value,
        allDay: true,
        endDate: value.endDate < value.startDate ? value.startDate : value.endDate,
      });
      return;
    }
    // Turning off all-day: default 9–10 AM on start date if times look like midnight
    const startTime =
      value.startTime === "00:00" ? "09:00" : value.startTime;
    const bumped = addHours(value.startDate, startTime, 1);
    onChange({
      ...value,
      allDay: false,
      startTime,
      endDate: bumped.date,
      endTime: bumped.time,
    });
  }

  const endInvalid = validateParts(value) !== null;

  return (
    <div className="space-y-2.5">
      <label className="flex items-center gap-2.5 text-sm text-foreground">
        <input
          type="checkbox"
          checked={value.allDay}
          disabled={disabled}
          onChange={(e) => setAllDay(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span className="font-medium">All day</span>
      </label>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Start date
          </span>
          <input
            required
            type="date"
            disabled={disabled}
            value={value.startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass}
          />
        </label>
        {!value.allDay ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Start time
            </span>
            <select
              required
              disabled={disabled}
              value={padTime(value.startTime)}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={`s-${t}`} value={t}>
                  {formatTimeLabel(t)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="hidden sm:block" />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            End date
          </span>
          <input
            required
            type="date"
            disabled={disabled}
            value={value.endDate}
            min={value.startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass}
          />
        </label>
        {!value.allDay ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              End time
            </span>
            <select
              required
              disabled={disabled}
              value={padTime(value.endTime)}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputClass}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={`e-${t}`} value={t}>
                  {formatTimeLabel(t)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="hidden sm:block" />
        )}
      </div>

      {endInvalid ? (
        <p className="text-xs font-medium text-danger" role="alert">
          End must be after start.
        </p>
      ) : (
        <p className="text-[11px] text-muted">
          Default length is 1 hour. Changing start auto-adjusts end when needed.
        </p>
      )}
    </div>
  );
}

export function defaultPartsForDay(day: Date): DateTimeParts {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  return {
    startDate: date,
    startTime: "09:00",
    endDate: date,
    endTime: "10:00",
    allDay: false,
  };
}

export function partsFromEvent(startsAt: string, endsAt: string, allDay: boolean): DateTimeParts {
  return {
    startDate: dateFromIso(startsAt),
    startTime: timeFromIso(startsAt),
    endDate: dateFromIso(endsAt),
    endTime: timeFromIso(endsAt),
    allDay,
  };
}
