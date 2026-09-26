/**
 * Generate a calm co-parenting message from a single selected household record.
 * CRITICAL: only cite fields present on the selected payload — never invent facts.
 */

export type ReferenceKind = "message" | "calendar" | "document" | "call";

export type SelectedMessageRecord = {
  kind: "message";
  id: string;
  senderLabel: string;
  body: string;
  createdAt: string;
  mine?: boolean;
};

export type SelectedCalendarRecord = {
  kind: "calendar";
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
};

export type SelectedDocumentRecord = {
  kind: "document";
  id: string;
  title: string;
  kindLabel?: string | null;
  updatedAt?: string | null;
  amount?: string | number | null;
  snippet?: string | null;
};

export type SelectedCallRecord = {
  kind: "call";
  id: string;
  summary: string;
  occurredAt: string;
  durationMinutes?: number | null;
};

export type SelectedReferenceRecord =
  | SelectedMessageRecord
  | SelectedCalendarRecord
  | SelectedDocumentRecord
  | SelectedCallRecord;

export type FactLine = { label: string; value: string };

export type ReferenceGenerateResult = {
  suggestion: string;
  facts: FactLine[];
  source: "heuristic" | "openai" | "anthropic";
};

function clip(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatWhen(iso: string): string | null {
  if (!iso || !String(iso).trim()) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return null;
  }
}

/** Extract only present, non-empty fields for confirm UI + prompts. */
export function factsFromRecord(record: SelectedReferenceRecord): FactLine[] {
  const facts: FactLine[] = [];

  switch (record.kind) {
    case "message": {
      if (record.senderLabel?.trim()) {
        facts.push({ label: "From", value: record.senderLabel.trim() });
      }
      const when = formatWhen(record.createdAt);
      if (when) facts.push({ label: "Date", value: when });
      if (record.body?.trim()) {
        facts.push({ label: "Message", value: clip(record.body.trim(), 280) });
      }
      break;
    }
    case "calendar": {
      if (record.title?.trim()) {
        facts.push({ label: "Title", value: record.title.trim() });
      }
      const start = formatWhen(record.startsAt);
      if (start) facts.push({ label: "Starts", value: start });
      const end = record.endsAt ? formatWhen(record.endsAt) : null;
      if (end) facts.push({ label: "Ends", value: end });
      if (record.location?.trim()) {
        facts.push({ label: "Location", value: record.location.trim() });
      }
      break;
    }
    case "document": {
      if (record.title?.trim()) {
        facts.push({ label: "Title", value: record.title.trim() });
      }
      if (record.kindLabel?.trim()) {
        facts.push({ label: "Type", value: record.kindLabel.trim() });
      }
      const updated = record.updatedAt ? formatWhen(record.updatedAt) : null;
      if (updated) facts.push({ label: "Updated", value: updated });
      if (
        record.amount != null &&
        String(record.amount).trim() !== "" &&
        Number.isFinite(Number(record.amount))
      ) {
        facts.push({ label: "Amount", value: String(record.amount) });
      } else if (
        record.amount != null &&
        typeof record.amount === "string" &&
        record.amount.trim()
      ) {
        facts.push({ label: "Amount", value: record.amount.trim() });
      }
      if (record.snippet?.trim()) {
        facts.push({ label: "Snippet", value: clip(record.snippet.trim(), 200) });
      }
      break;
    }
    case "call": {
      const when = formatWhen(record.occurredAt);
      if (when) facts.push({ label: "Date", value: when });
      if (
        typeof record.durationMinutes === "number" &&
        Number.isFinite(record.durationMinutes)
      ) {
        facts.push({
          label: "Duration",
          value: `${record.durationMinutes} min`,
        });
      }
      if (record.summary?.trim()) {
        facts.push({ label: "Summary", value: clip(record.summary.trim(), 280) });
      }
      break;
    }
  }

  return facts;
}

export function recordHasUsableFacts(record: SelectedReferenceRecord): boolean {
  return factsFromRecord(record).length > 0;
}

/** Deterministic rewrite that only interpolates present fact values. */
export function heuristicReferenceMessage(
  record: SelectedReferenceRecord
): string {
  const facts = factsFromRecord(record);
  if (facts.length === 0) {
    return "";
  }

  switch (record.kind) {
    case "message": {
      const who = record.senderLabel?.trim() || "you";
      const when = formatWhen(record.createdAt);
      const snippet = record.body?.trim()
        ? clip(record.body.trim(), 90)
        : null;
      const regarding = when
        ? `Regarding your message from ${when}${snippet ? ` ("${snippet}")` : ""}`
        : snippet
          ? `Regarding your message ("${snippet}")`
          : `Regarding the message from ${who}`;
      return `${regarding}: I'd like to keep this focused on the kids and next steps. Can we address this calmly and confirm what needs to happen next?`;
    }
    case "calendar": {
      const title = record.title?.trim();
      const when = formatWhen(record.startsAt);
      const loc = record.location?.trim();
      let regarding = "Regarding the shared calendar event";
      if (title) regarding = `Regarding the calendar event "${title}"`;
      if (when) regarding += ` on ${when}`;
      if (loc) regarding += ` at ${loc}`;
      return `${regarding}: Can we confirm the plan and any needed updates so it stays accurate for the kids? Please reply with what works on your end.`;
    }
    case "document": {
      const title = record.title?.trim();
      const type = record.kindLabel?.trim();
      const amount =
        record.amount != null && String(record.amount).trim() !== ""
          ? String(record.amount).trim()
          : null;
      let regarding = "Regarding the shared document";
      if (title) regarding = `Regarding the shared document "${title}"`;
      if (type) regarding += ` (${type})`;
      const amountBit = amount ? ` The recorded amount is ${amount}.` : "";
      return `${regarding}:${amountBit} Can you confirm the details and how you'd like to handle next steps?`;
    }
    case "call": {
      const when = formatWhen(record.occurredAt);
      const summary = record.summary?.trim()
        ? clip(record.summary.trim(), 100)
        : null;
      let regarding = "Following up on our call";
      if (when) regarding += ` from ${when}`;
      if (summary) regarding += ` (${summary})`;
      return `${regarding}: For the record, please reply if any of those points need correction so we stay aligned for the kids.`;
    }
    default:
      return "";
  }
}

function formatFactsForPrompt(facts: FactLine[]): string {
  if (facts.length === 0) return "(no fields present)";
  return facts.map((f) => `- ${f.label}: ${f.value}`).join("\n");
}

function systemPrompt(): string {
  return (
    "You write calm, factual, court-appropriate co-parenting messages. " +
    "Return ONLY the message text. No quotes, no preamble, no bullet lists. " +
    "CRITICAL RULES: " +
    "(1) You may ONLY cite facts listed in the Selected record fields block. " +
    "(2) Do NOT invent titles, dates, amounts, locations, names, summaries, or any other details. " +
    "(3) If a field is missing, omit it — never guess or fill in placeholders as if they were real. " +
    "(4) Never include insults, threats, or contempt. " +
    "(5) Keep the tone cooperative and kids-focused."
  );
}

async function generateWithOpenAI(
  facts: FactLine[],
  kind: ReferenceKind,
  apiKey: string
): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        { role: "system", content: systemPrompt() },
        {
          role: "user",
          content:
            `Write one short co-parenting message that references this ${kind} record.\n\n` +
            `Selected record fields (ONLY source of truth):\n${formatFactsForPrompt(facts)}\n\n` +
            `Ask calmly for confirmation or next steps. Cite only the fields above.`,
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function generateWithAnthropic(
  facts: FactLine[],
  kind: ReferenceKind,
  apiKey: string
): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 220,
      temperature: 0.2,
      system: systemPrompt(),
      messages: [
        {
          role: "user",
          content:
            `Write one short co-parenting message that references this ${kind} record.\n\n` +
            `Selected record fields (ONLY source of truth):\n${formatFactsForPrompt(facts)}\n\n` +
            `Ask calmly for confirmation or next steps. Cite only the fields above.`,
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return data.content?.find((c) => c.type === "text")?.text?.trim() || null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function parseSelectedRecord(
  kind: unknown,
  record: unknown
): SelectedReferenceRecord | null {
  if (
    kind !== "message" &&
    kind !== "calendar" &&
    kind !== "document" &&
    kind !== "call"
  ) {
    return null;
  }
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;
  const id = isNonEmptyString(r.id) ? r.id.trim() : "";

  switch (kind) {
    case "message": {
      if (!isNonEmptyString(r.body) && !isNonEmptyString(r.createdAt)) {
        return null;
      }
      return {
        kind: "message",
        id: id || "message",
        senderLabel: isNonEmptyString(r.senderLabel)
          ? r.senderLabel.trim().slice(0, 200)
          : "Co-parent",
        body: isNonEmptyString(r.body) ? r.body.trim().slice(0, 2000) : "",
        createdAt: isNonEmptyString(r.createdAt) ? r.createdAt.trim() : "",
        mine: Boolean(r.mine),
      };
    }
    case "calendar": {
      if (!isNonEmptyString(r.title) && !isNonEmptyString(r.startsAt)) {
        return null;
      }
      return {
        kind: "calendar",
        id: id || "event",
        title: isNonEmptyString(r.title) ? r.title.trim().slice(0, 300) : "",
        startsAt: isNonEmptyString(r.startsAt) ? r.startsAt.trim() : "",
        endsAt: isNonEmptyString(r.endsAt) ? r.endsAt.trim() : null,
        location: isNonEmptyString(r.location)
          ? r.location.trim().slice(0, 300)
          : null,
      };
    }
    case "document": {
      if (!isNonEmptyString(r.title) && r.amount == null && !isNonEmptyString(r.snippet)) {
        return null;
      }
      let amount: string | number | null = null;
      if (typeof r.amount === "number" && Number.isFinite(r.amount)) {
        amount = r.amount;
      } else if (isNonEmptyString(r.amount)) {
        amount = r.amount.trim().slice(0, 40);
      }
      return {
        kind: "document",
        id: id || "document",
        title: isNonEmptyString(r.title) ? r.title.trim().slice(0, 300) : "",
        kindLabel: isNonEmptyString(r.kindLabel)
          ? r.kindLabel.trim().slice(0, 100)
          : isNonEmptyString(r.kind)
            ? r.kind.trim().slice(0, 100)
            : null,
        updatedAt: isNonEmptyString(r.updatedAt) ? r.updatedAt.trim() : null,
        amount,
        snippet: isNonEmptyString(r.snippet)
          ? r.snippet.trim().slice(0, 500)
          : null,
      };
    }
    case "call": {
      if (!isNonEmptyString(r.summary) && !isNonEmptyString(r.occurredAt)) {
        return null;
      }
      return {
        kind: "call",
        id: id || "call",
        summary: isNonEmptyString(r.summary)
          ? r.summary.trim().slice(0, 500)
          : "",
        occurredAt: isNonEmptyString(r.occurredAt) ? r.occurredAt.trim() : "",
        durationMinutes:
          typeof r.durationMinutes === "number" &&
          Number.isFinite(r.durationMinutes)
            ? r.durationMinutes
            : null,
      };
    }
    default:
      return null;
  }
}

export async function generateFromReference(
  record: SelectedReferenceRecord
): Promise<ReferenceGenerateResult> {
  const facts = factsFromRecord(record);
  if (facts.length === 0) {
    return { suggestion: "", facts, source: "heuristic" };
  }

  const fallback = heuristicReferenceMessage(record);
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();

  try {
    if (openaiKey) {
      const suggestion = await generateWithOpenAI(facts, record.kind, openaiKey);
      if (suggestion) {
        return { suggestion, facts, source: "openai" };
      }
    }
    if (anthropicKey) {
      const suggestion = await generateWithAnthropic(
        facts,
        record.kind,
        anthropicKey
      );
      if (suggestion) {
        return { suggestion, facts, source: "anthropic" };
      }
    }
  } catch {
    // Fall through to heuristic
  }

  return { suggestion: fallback, facts, source: "heuristic" };
}
