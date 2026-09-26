/**
 * Household context for tone coaching rewrites.
 * Messages are live; calendar / documents / calls are stubbed until those
 * modules ship tables. Hooks below accept real rows when available.
 */

export type ContextMessage = {
  id: string;
  senderLabel: string;
  body: string;
  createdAt: string;
  mine?: boolean;
};

export type ContextCalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
};

export type ContextDocument = {
  id: string;
  title: string;
  kind?: string | null;
  updatedAt?: string | null;
};

export type ContextCallLog = {
  id: string;
  summary: string;
  occurredAt: string;
  durationMinutes?: number | null;
};

export type HouseholdToneContext = {
  recentMessages?: ContextMessage[];
  calendarEvents?: ContextCalendarEvent[];
  documents?: ContextDocument[];
  callLogs?: ContextCallLog[];
};

export type ReferenceKind = "message" | "calendar" | "document" | "call";

export const REFERENCE_CHIPS: Array<{
  id: ReferenceKind;
  label: string;
  /** True when the backing module is still a placeholder. */
  stub: boolean;
}> = [
  { id: "message", label: "Reference last message", stub: false },
  { id: "calendar", label: "Reference calendar", stub: true },
  { id: "document", label: "Reference document", stub: true },
  { id: "call", label: "Reference call", stub: true },
];

function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Build a compact context block for LLM prompts / heuristic grounding. */
export function formatContextForPrompt(ctx: HouseholdToneContext): string {
  const lines: string[] = [];

  const msgs = ctx.recentMessages ?? [];
  if (msgs.length > 0) {
    lines.push("Recent household messages (oldest → newest):");
    for (const m of msgs.slice(-8)) {
      lines.push(
        `- [${formatWhen(m.createdAt)}] ${m.senderLabel}${m.mine ? " (me)" : ""}: ${clip(m.body, 220)}`
      );
    }
  } else {
    lines.push("Recent household messages: (none yet)");
  }

  const events = ctx.calendarEvents ?? [];
  if (events.length > 0) {
    lines.push("Upcoming / recent calendar events:");
    for (const e of events.slice(0, 5)) {
      lines.push(
        `- ${e.title} @ ${formatWhen(e.startsAt)}${e.location ? ` (${e.location})` : ""}`
      );
    }
  } else {
    lines.push(
      "Calendar events: (module stub — no live events yet; if citing calendar, ask to confirm the specific event on /app/calendar)"
    );
  }

  const docs = ctx.documents ?? [];
  if (docs.length > 0) {
    lines.push("Shared documents:");
    for (const d of docs.slice(0, 5)) {
      lines.push(
        `- ${d.title}${d.kind ? ` [${d.kind}]` : ""}${d.updatedAt ? ` updated ${formatWhen(d.updatedAt)}` : ""}`
      );
    }
  } else {
    lines.push(
      "Documents: (module stub — no vault rows yet; if citing a document, ask which order/receipt on /app/documents)"
    );
  }

  const calls = ctx.callLogs ?? [];
  if (calls.length > 0) {
    lines.push("Call / conversation logs:");
    for (const c of calls.slice(0, 5)) {
      lines.push(`- ${formatWhen(c.occurredAt)}: ${clip(c.summary, 180)}`);
    }
  } else {
    lines.push(
      "Call logs: (module stub — no call records yet; if citing a call, refer to the most recent discussion in general terms and invite confirmation)"
    );
  }

  return lines.join("\n");
}

export function lastOtherMessage(
  ctx: HouseholdToneContext
): ContextMessage | null {
  const msgs = ctx.recentMessages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (!msgs[i].mine) return msgs[i];
  }
  return msgs.length > 0 ? msgs[msgs.length - 1] : null;
}

/** Insertable grounded phrasing for UI reference chips. */
export function referenceSnippet(
  kind: ReferenceKind,
  ctx: HouseholdToneContext
): string {
  switch (kind) {
    case "message": {
      const last = lastOtherMessage(ctx);
      if (last) {
        return `Regarding your message from ${formatWhen(last.createdAt)} ("${clip(last.body, 90)}"): `;
      }
      return "Regarding our last message in this thread: ";
    }
    case "calendar": {
      const event = ctx.calendarEvents?.[0];
      if (event) {
        return `Regarding the calendar event "${event.title}" on ${formatWhen(event.startsAt)}: `;
      }
      return "Regarding the shared custody calendar (please confirm the specific event on Calendar): ";
    }
    case "document": {
      const doc = ctx.documents?.[0];
      if (doc) {
        return `Regarding the shared document "${doc.title}"${doc.kind ? ` (${doc.kind})` : ""}: `;
      }
      return "Regarding the document in our shared vault (please confirm which file on Documents): ";
    }
    case "call": {
      const call = ctx.callLogs?.[0];
      if (call) {
        return `Following up on our call from ${formatWhen(call.occurredAt)} (${clip(call.summary, 80)}): `;
      }
      return "Following up on our recent call/discussion (please confirm the date if needed): ";
    }
    default:
      return "";
  }
}

/**
 * Future data loaders — real queries can replace these stubs without changing
 * the tone API shape. Today messages come from the client; others return [].
 */
export async function loadCalendarContextStub(
  _householdId: string
): Promise<ContextCalendarEvent[]> {
  return [];
}

export async function loadDocumentsContextStub(
  _householdId: string
): Promise<ContextDocument[]> {
  return [];
}

export async function loadCallLogsContextStub(
  _householdId: string
): Promise<ContextCallLog[]> {
  return [];
}

export function buildClientToneContext(args: {
  messages: Array<{
    id: string;
    body: string;
    created_at: string;
    sender_id: string;
    sender_email: string | null;
    sender_display_name: string | null;
  }>;
  userId: string;
  calendarEvents?: ContextCalendarEvent[];
  documents?: ContextDocument[];
  callLogs?: ContextCallLog[];
}): HouseholdToneContext {
  const recentMessages: ContextMessage[] = args.messages.slice(-8).map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    mine: m.sender_id === args.userId,
    senderLabel:
      m.sender_display_name ??
      m.sender_email ??
      (m.sender_id === args.userId ? "Me" : "Co-parent"),
  }));

  return {
    recentMessages,
    calendarEvents: args.calendarEvents ?? [],
    documents: args.documents ?? [],
    callLogs: args.callLogs ?? [],
  };
}
