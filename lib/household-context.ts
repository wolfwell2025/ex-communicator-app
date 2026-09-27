/**
 * Household context for tone coaching rewrites.
 * Messages + shared calendar + shared documents + expenses are live; calls
 * stay empty until that module ships. Prefer empty/real over fabricated demo
 * rows. Calendar / documents context must use visibility=shared only
 * (never private/pending). Expenses use requested/accepted/paid only.
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
  amount?: string | number | null;
  snippet?: string | null;
};

export type ContextExpense = {
  id: string;
  title: string;
  categoryLabel?: string | null;
  statusLabel?: string | null;
  amountLabel?: string | null;
  shareLabel?: string | null;
  incurredOn?: string | null;
  status?: string | null;
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
  expenses?: ContextExpense[];
  callLogs?: ContextCallLog[];
};

export type ReferenceKind =
  | "message"
  | "calendar"
  | "document"
  | "expense"
  | "call";

export const REFERENCE_CHIPS: Array<{
  id: ReferenceKind;
  label: string;
  /** True when the backing module has no live DB table yet. */
  stub: boolean;
}> = [
  { id: "message", label: "Reference last message", stub: false },
  { id: "calendar", label: "Reference calendar", stub: false },
  { id: "document", label: "Reference document", stub: false },
  { id: "expense", label: "Reference expense", stub: false },
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
    lines.push("Recent parenting team messages (oldest to newest):");
    for (const m of msgs.slice(-8)) {
      lines.push(
        `- [${formatWhen(m.createdAt)}] ${m.senderLabel}${m.mine ? " (me)" : ""}: ${clip(m.body, 220)}`
      );
    }
  } else {
    lines.push("Recent parenting team messages: (none yet)");
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
      "Calendar events: (empty — no live events; do not invent titles or dates)"
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
      "Documents: (empty — no vault rows; do not invent document titles)"
    );
  }

  const expenses = ctx.expenses ?? [];
  if (expenses.length > 0) {
    lines.push("Shared expenses:");
    for (const e of expenses.slice(0, 5)) {
      lines.push(
        `- ${e.title}${e.categoryLabel ? ` [${e.categoryLabel}]` : ""}${e.amountLabel ? ` total ${e.amountLabel}` : ""}${e.shareLabel ? ` share ${e.shareLabel}` : ""}${e.statusLabel ? ` (${e.statusLabel})` : ""}`
      );
    }
  } else {
    lines.push(
      "Expenses: (empty - no reimbursement rows; do not invent amounts)"
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
      "Call logs: (empty — no call records; do not invent call summaries)"
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

/**
 * @deprecated Prefer the Reference picker + /api/reference-generate so the
 * user confirms facts before a message is drafted. Kept for tone-check
 * fallbacks that already have live context.
 */
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
      return "";
    }
    case "calendar": {
      const event = ctx.calendarEvents?.[0];
      if (event?.title?.trim() && event.startsAt) {
        return `Regarding the calendar event "${event.title}" on ${formatWhen(event.startsAt)}: `;
      }
      return "";
    }
    case "document": {
      const doc = ctx.documents?.[0];
      if (doc?.title?.trim()) {
        return `Regarding the shared document "${doc.title}"${doc.kind ? ` (${doc.kind})` : ""}: `;
      }
      return "";
    }
    case "expense": {
      const expense = ctx.expenses?.[0];
      if (expense?.title?.trim()) {
        const amount = expense.shareLabel || expense.amountLabel;
        return `Regarding the expense "${expense.title}"${amount ? ` (${amount})` : ""}: `;
      }
      return "";
    }
    case "call": {
      const call = ctx.callLogs?.[0];
      if (call?.occurredAt && call.summary?.trim()) {
        return `Following up on our call from ${formatWhen(call.occurredAt)} (${clip(call.summary, 80)}): `;
      }
      return "";
    }
    default:
      return "";
  }
}

/** @deprecated Prefer listSharedCalendarEvents from lib/calendar. */
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
  expenses?: ContextExpense[];
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

  /** Full thread for the reference picker (not just last 8). */
  return {
    recentMessages,
    calendarEvents: args.calendarEvents ?? [],
    documents: args.documents ?? [],
    expenses: args.expenses ?? [],
    callLogs: args.callLogs ?? [],
  };
}

/** Map all thread messages into picker/context rows (accurate, no stubs). */
export function messagesToContextRows(
  messages: Array<{
    id: string;
    body: string;
    created_at: string;
    sender_id: string;
    sender_email: string | null;
    sender_display_name: string | null;
  }>,
  userId: string
): ContextMessage[] {
  return messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    mine: m.sender_id === userId,
    senderLabel:
      m.sender_display_name ??
      m.sender_email ??
      (m.sender_id === userId ? "Me" : "Co-parent"),
  }));
}
