import {
  formatContextForPrompt,
  lastOtherMessage,
  type HouseholdToneContext,
} from "@/lib/household-context";

export type ToneSeverity = "low" | "medium" | "high";

export type ToneObjective =
  | "schedule"
  | "expense"
  | "pickup"
  | "record"
  | "other";

export const TONE_OBJECTIVES: Array<{
  id: ToneObjective;
  label: string;
  hint: string;
}> = [
  {
    id: "schedule",
    label: "Schedule change",
    hint: "Adjust parenting time, holidays, or the calendar",
  },
  {
    id: "expense",
    label: "Expense reimbursement",
    hint: "Ask about shared costs or payment",
  },
  {
    id: "pickup",
    label: "Pickup / drop-off logistics",
    hint: "Time, place, or who is transporting the kids",
  },
  {
    id: "record",
    label: "Document something for the record",
    hint: "Put a factual note on the permanent transcript",
  },
  {
    id: "other",
    label: "Other co-parenting topic",
    hint: "School, health, activities, or another kids-focused issue",
  },
];

export type ToneCheckResult = {
  flagged: boolean;
  severity?: ToneSeverity;
  warning: string;
  suggestion: string;
  source?: "heuristic" | "openai" | "anthropic";
  objective?: ToneObjective;
};

const INSULTS = [
  "bitch",
  "bastard",
  "asshole",
  "a-hole",
  "shithead",
  "shit head",
  "dumbass",
  "dumb ass",
  "idiot",
  "moron",
  "stupid",
  "retard",
  "retarded",
  "loser",
  "whore",
  "slut",
  "cunt",
  "fuck you",
  "fucker",
  "motherfucker",
  "piece of shit",
  "pos",
  "scumbag",
  "trash",
  "garbage",
  "worthless",
  "pathetic",
  "narcissist",
  "psycho",
  "crazy bitch",
  "fat",
  "ugly",
];

const THREATS = [
  "i'll kill",
  "ill kill",
  "i will kill",
  "kill you",
  "hurt you",
  "beat you",
  "destroy you",
  "ruin you",
  "take the kids",
  "take our kid",
  "you'll never see",
  "you will never see",
  "court will destroy",
  "sue your ass",
  "make you pay",
];

const CONTEMPT = [
  "you always",
  "you never",
  "typical you",
  "you're a joke",
  "you are a joke",
  "go to hell",
  "screw you",
  "shut up",
  "shut the fuck up",
  "i hate you",
  "hate your guts",
  "don't even",
  "dont even bother",
  "waste of space",
  "worst parent",
  "bad parent",
  "unfit",
];

const COURT_WARNING =
  "Pause before sending. This message may read as hostile on a court-usable transcript. Co-parenting works better when messages stay factual and calm.";

const HIGH_WARNING =
  "Strong warning: insults or threats can hurt your co-parenting record. Rewrite before you send.";

const ESCALATED_WARNING =
  "You've drafted multiple hostile messages in this session. Messages here are permanent and court-usable. Tell us what you're trying to accomplish so we can draft a safer message grounded in your household record.";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(haystack: string, needles: string[]): string | null {
  for (const needle of needles) {
    if (haystack.includes(needle)) return needle;
  }
  return null;
}

function wordBoundaryInsult(haystack: string): string | null {
  for (const insult of INSULTS) {
    if (insult.includes(" ")) {
      if (haystack.includes(insult)) return insult;
      continue;
    }
    const re = new RegExp(`(?:^|[^a-z0-9])${insult}(?:[^a-z0-9]|$)`, "i");
    if (re.test(haystack)) return insult;
  }
  return null;
}

function stripHostilePhrases(text: string): string {
  let out = text;
  const patterns = [
    /\byou('re| are|r)?\s+(a\s+)?(fucking\s+)?(bitch|bastard|asshole|idiot|moron|loser|whore|slut|cunt|piece of shit)\b/gi,
    /\b(fuck you|screw you|shut (the fuck )?up|go to hell|i hate you)\b/gi,
    /\b(stupid|pathetic|worthless|garbage|trash)\b/gi,
  ];
  for (const re of patterns) {
    out = out.replace(re, "");
  }
  return out.replace(/\s{2,}/g, " ").replace(/^[,.\s!-]+|[,.\s!-]+$/g, "").trim();
}

function clip(text: string, max = 90): string {
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

function contextLeadIn(ctx?: HouseholdToneContext): string {
  if (!ctx) return "";

  const last = lastOtherMessage(ctx);
  if (last) {
    return `Regarding your message from ${formatWhen(last.createdAt)} ("${clip(last.body)}"): `;
  }

  const event = ctx.calendarEvents?.[0];
  if (event) {
    return `Regarding the calendar event "${event.title}" on ${formatWhen(event.startsAt)}: `;
  }

  const doc = ctx.documents?.[0];
  if (doc) {
    return `Regarding the shared document "${doc.title}": `;
  }

  const call = ctx.callLogs?.[0];
  if (call) {
    return `Following up on our call from ${formatWhen(call.occurredAt)}: `;
  }

  return "";
}

function objectiveRewrite(
  objective: ToneObjective,
  original: string,
  ctx?: HouseholdToneContext
): string {
  const cleaned = stripHostilePhrases(original);
  const detail =
    cleaned.length >= 8
      ? ` ${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}${/[.!?]$/.test(cleaned) ? "" : "."}`
      : "";
  const lead = contextLeadIn(ctx);
  const event = ctx?.calendarEvents?.[0];
  const doc = ctx?.documents?.[0];
  const call = ctx?.callLogs?.[0];
  const last = lastOtherMessage(ctx ?? {});

  switch (objective) {
    case "schedule":
      if (event) {
        return `${lead}I'd like to propose a change related to "${event.title}" on ${formatWhen(event.startsAt)}.${detail} Please reply with times that work so we can update the shared calendar.`;
      }
      return `${lead || "Regarding our parenting schedule: "}I'd like to discuss a schedule change for the kids.${detail} Please confirm which calendar event this affects (see Calendar) and what dates/times work on your end.`;
    case "expense":
      if (doc) {
        return `${lead}I'm following up about reimbursement related to "${doc.title}".${detail} Can you confirm the amount and how you'd like to handle payment?`;
      }
      return `${lead || "Regarding a shared expense: "}I'm following up about a kids-related cost.${detail} If there's a receipt in Documents, please confirm which one and how you'd like to handle reimbursement.`;
    case "pickup":
      if (event) {
        return `${lead}Can we confirm pickup/drop-off for "${event.title}" on ${formatWhen(event.startsAt)}?${detail} Please reply with the time and location.`;
      }
      if (last) {
        return `${lead}Can we confirm pickup/drop-off logistics for the kids?${detail} Please reply with the time and location so it matches what we discussed in the thread.`;
      }
      return `${lead || "Regarding pickup/drop-off: "}Can we confirm logistics for the kids?${detail} Please reply with the time and location, and we can mirror it on the shared calendar.`;
    case "record":
      if (doc) {
        return `${lead}For the record, I want to document the following regarding "${doc.title}":${detail || " [add factual details]."} Please reply if any facts need correction.`;
      }
      if (call) {
        return `${lead}For the record, following our call on ${formatWhen(call.occurredAt)} (${clip(call.summary)}):${detail || " [add factual details]."} Please reply if any facts need correction.`;
      }
      if (last) {
        return `${lead}For the record, I want to document a factual note on this thread:${detail || " [add factual details]."} Please reply if any of these facts need correction.`;
      }
      return `${lead || "For the record: "}I want to document the following regarding our co-parenting arrangement:${detail || " [add the factual details here]."} Please reply if any facts need correction.`;
    case "other":
    default:
      if (last) {
        return `${lead}I'd like to keep this focused on the kids and next steps.${detail || " Can we address the specific issue calmly based on the thread above?"}`;
      }
      return `${lead || ""}I'd like to keep this focused on the kids and next steps.${detail || " Can we address the specific issue calmly?"}${!ctx?.recentMessages?.length ? " Happy to reference the calendar, a shared document, or a prior call once you point me to which one." : ""}`;
  }
}

function heuristicRewrite(
  original: string,
  hit: string | null,
  ctx?: HouseholdToneContext
): string {
  const cleaned = stripHostilePhrases(original);
  const lower = normalize(original);
  const lead = contextLeadIn(ctx);

  if (
    /bitch|asshole|idiot|moron|loser|whore|slut|cunt|piece of shit|fuck you/.test(
      lower
    )
  ) {
    if (cleaned.length >= 12) {
      return `${lead}I want to keep this focused on our kids. ${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}${/[.!?]$/.test(cleaned) ? "" : "."} Can we stick to the schedule, documents, or next logistics step?`;
    }
    if (lead) {
      return `${lead}I want to keep our messages focused on the kids and logistics. Can we stick to the facts in that item and what needs to happen next?`;
    }
    return "I want to keep our messages focused on the kids and logistics. Can we stick to the facts—referencing our last message, calendar, or a shared document—and what needs to happen next?";
  }

  if (containsAny(lower, THREATS)) {
    return `${lead || ""}I am concerned about our current plan and would like to resolve this calmly. Can we discuss options that work for the kids without escalating${lead ? "" : ", referencing the calendar or prior messages as needed"}?`;
  }

  if (/you always|you never|typical you|worst parent|unfit|i hate you/.test(lower)) {
    return `${lead || ""}I disagree with how this was handled. Going forward, can we agree on a clear plan for pickup/drop-off and communication so the kids have consistency?`;
  }

  if (cleaned.length >= 8) {
    return `${lead}Let's keep this constructive. ${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}${/[.!?]$/.test(cleaned) ? "" : "."}`;
  }

  if (hit) {
    return `${lead || ""}I'd like to keep this conversation respectful and focused on co-parenting. What is the specific schedule, document, or logistics issue we need to solve?`;
  }

  return `${lead || ""}Can we keep this message factual and focused on what the kids need next?`;
}

export function isToneObjective(value: unknown): value is ToneObjective {
  return (
    value === "schedule" ||
    value === "expense" ||
    value === "pickup" ||
    value === "record" ||
    value === "other"
  );
}

export function heuristicToneCheck(
  text: string,
  objective?: ToneObjective,
  ctx?: HouseholdToneContext
): ToneCheckResult {
  const trimmed = text.trim();
  if (!trimmed && !objective) {
    return { flagged: false, warning: "", suggestion: "", source: "heuristic" };
  }

  const lower = normalize(trimmed || "");
  const insult = trimmed ? wordBoundaryInsult(lower) : null;
  const threat = trimmed ? containsAny(lower, THREATS) : null;
  const contempt = trimmed ? containsAny(lower, CONTEMPT) : null;

  const shouty =
    trimmed.length > 8 &&
    trimmed === trimmed.toUpperCase() &&
    /[A-Z]/.test(trimmed) &&
    /[!?]{2,}|fuck|shit|damn/i.test(trimmed);

  const flagged = Boolean(insult || threat || contempt || shouty);

  let severity: ToneSeverity | undefined;
  if (flagged) {
    severity = "medium";
    if (threat || (insult && /kill|hurt|cunt|fuck you|piece of shit/.test(lower))) {
      severity = "high";
    } else if (contempt && !insult) {
      severity = "low";
    }
  }

  let suggestion = "";
  if (objective) {
    suggestion = objectiveRewrite(objective, trimmed, ctx);
  } else if (flagged) {
    suggestion = heuristicRewrite(trimmed, insult ?? threat ?? contempt, ctx);
  }

  let warning = "";
  if (flagged) {
    warning = severity === "high" ? HIGH_WARNING : COURT_WARNING;
  }

  return {
    flagged,
    ...(severity ? { severity } : {}),
    warning,
    suggestion,
    source: "heuristic",
    ...(objective ? { objective } : {}),
  };
}

/** Lightweight client-side gate so we only hit the API when text may be hostile. */
export function looksHostileClient(text: string): boolean {
  return heuristicToneCheck(text).flagged;
}

export function escalatedWarning(): string {
  return ESCALATED_WARNING;
}

function systemPrompt(objective?: ToneObjective): string {
  const objectiveHint = objective
    ? ` The writer's stated objective is: ${TONE_OBJECTIVES.find((o) => o.id === objective)?.label ?? objective}. Shape the rewrite around that goal.`
    : "";
  return (
    "You rewrite co-parenting messages to be calm, factual, and court-appropriate. " +
    "Return ONLY the rewritten message text. No quotes, no preamble. " +
    "You MUST ground the rewrite in the provided household context when present: " +
    "cite the last relevant message (quote a short fragment + date), name calendar events, " +
    "shared documents, or call logs when those lists have real items. " +
    "If a context section is marked as a module stub / empty, do not invent fake titles— " +
    "invite the co-parent to confirm which calendar event, document, or call is meant. " +
    "Never include insults, threats, or contempt." +
    objectiveHint
  );
}

async function rewriteWithOpenAI(
  text: string,
  apiKey: string,
  objective?: ToneObjective,
  ctx?: HouseholdToneContext
): Promise<string | null> {
  const contextBlock = ctx ? formatContextForPrompt(ctx) : "(no context provided)";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 280,
      messages: [
        { role: "system", content: systemPrompt(objective) },
        {
          role: "user",
          content: `Household context:\n${contextBlock}\n\nRewrite this co-parenting message:\n\n${text}`,
        },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  return content || null;
}

async function rewriteWithAnthropic(
  text: string,
  apiKey: string,
  objective?: ToneObjective,
  ctx?: HouseholdToneContext
): Promise<string | null> {
  const contextBlock = ctx ? formatContextForPrompt(ctx) : "(no context provided)";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 280,
      temperature: 0.3,
      system: systemPrompt(objective),
      messages: [
        {
          role: "user",
          content: `Household context:\n${contextBlock}\n\nRewrite this co-parenting message:\n\n${text}`,
        },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const content = data.content?.find((c) => c.type === "text")?.text?.trim();
  return content || null;
}

function parseContext(raw: unknown): HouseholdToneContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const ctx: HouseholdToneContext = {};

  if (Array.isArray(o.recentMessages)) {
    ctx.recentMessages = o.recentMessages
      .filter((m) => m && typeof m === "object")
      .slice(-8)
      .map((m) => {
        const row = m as Record<string, unknown>;
        return {
          id: String(row.id ?? ""),
          senderLabel: String(row.senderLabel ?? "Co-parent"),
          body: String(row.body ?? "").slice(0, 2000),
          createdAt: String(row.createdAt ?? ""),
          mine: Boolean(row.mine),
        };
      });
  }
  if (Array.isArray(o.calendarEvents)) {
    ctx.calendarEvents = o.calendarEvents
      .filter((e) => e && typeof e === "object")
      .slice(0, 5)
      .map((e) => {
        const row = e as Record<string, unknown>;
        return {
          id: String(row.id ?? ""),
          title: String(row.title ?? "Event"),
          startsAt: String(row.startsAt ?? ""),
          endsAt: row.endsAt == null ? null : String(row.endsAt),
          location: row.location == null ? null : String(row.location),
        };
      });
  }
  if (Array.isArray(o.documents)) {
    ctx.documents = o.documents
      .filter((d) => d && typeof d === "object")
      .slice(0, 5)
      .map((d) => {
        const row = d as Record<string, unknown>;
        return {
          id: String(row.id ?? ""),
          title: String(row.title ?? "Document"),
          kind: row.kind == null ? null : String(row.kind),
          updatedAt: row.updatedAt == null ? null : String(row.updatedAt),
        };
      });
  }
  if (Array.isArray(o.callLogs)) {
    ctx.callLogs = o.callLogs
      .filter((c) => c && typeof c === "object")
      .slice(0, 5)
      .map((c) => {
        const row = c as Record<string, unknown>;
        return {
          id: String(row.id ?? ""),
          summary: String(row.summary ?? "").slice(0, 500),
          occurredAt: String(row.occurredAt ?? ""),
          durationMinutes:
            typeof row.durationMinutes === "number"
              ? row.durationMinutes
              : null,
        };
      });
  }

  return ctx;
}

export function coerceToneContext(raw: unknown): HouseholdToneContext | undefined {
  return parseContext(raw);
}

export async function checkTone(
  text: string,
  objective?: ToneObjective,
  ctx?: HouseholdToneContext
): Promise<ToneCheckResult> {
  const base = heuristicToneCheck(text, objective, ctx);
  if (!base.flagged && !objective) return base;

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const draft = text.trim() || base.suggestion;

  try {
    if (openaiKey) {
      const suggestion = await rewriteWithOpenAI(
        draft,
        openaiKey,
        objective,
        ctx
      );
      if (suggestion) {
        return { ...base, suggestion, source: "openai" };
      }
    }
    if (anthropicKey) {
      const suggestion = await rewriteWithAnthropic(
        draft,
        anthropicKey,
        objective,
        ctx
      );
      if (suggestion) {
        return { ...base, suggestion, source: "anthropic" };
      }
    }
  } catch {
    // Fall through to heuristic suggestion
  }

  return base;
}
