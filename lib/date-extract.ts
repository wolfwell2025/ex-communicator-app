/**
 * Extract date/time candidates and detect affirmative replies in messages.
 * Uses chrono-node for natural language; fallback heuristics for common phrases.
 */

import * as chrono from "chrono-node";

export type ExtractedDateTime = {
  /** Original matched text */
  text: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** Confidence 0-1 for ranking */
  confidence: number;
};

const AFFIRM_PATTERNS: RegExp[] = [
  /^(yes|yep|yeah|yea|yup|ok|okay|k|kk)\b/i,
  /\b(yes|yep|yeah|ok|okay)\b[!.,]*$/i,
  /\b(that works|works for me|sounds good|sounds great|perfect|confirmed|confirm|deal|agreed|i agree|i'?m in|let'?s do it|see you then|see ya then)\b/i,
  /^(👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|✅|👌|💯)+$/,
  /\b(👍|✅)\b/,
];

/** True if body looks like an affirmative confirmation (not a question). */
export function isAffirmativeReply(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 280) return false;
  if (/\?/.test(trimmed) && !/\b(yes|ok|okay|works)\b/i.test(trimmed)) {
    return false;
  }
  // Reject clear negatives
  if (
    /\b(no|nope|not|can'?t|cannot|won'?t|unavailable|busy that|doesn'?t work)\b/i.test(
      trimmed
    ) &&
    !/\b(not a problem|no problem|no worries)\b/i.test(trimmed)
  ) {
    return false;
  }
  return AFFIRM_PATTERNS.some((re) => re.test(trimmed));
}

function defaultEnd(start: Date, allDay: boolean): Date {
  const end = new Date(start.getTime());
  if (allDay) {
    end.setHours(23, 59, 59, 999);
  } else {
    end.setMinutes(end.getMinutes() + 60);
  }
  return end;
}

function isAllDayResult(result: chrono.ParsedResult): boolean {
  const start = result.start;
  // chrono often omits hour/minute for date-only parses
  return !start.isCertain("hour") && !start.isCertain("minute");
}

function titleFromContext(text: string, matched: string): string {
  const cleaned = text
    .replace(matched, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (cleaned.length >= 3) return cleaned;
  return matched.trim().slice(0, 120) || "Suggested event";
}

/**
 * Parse natural language date/times from arbitrary text.
 * Returns unique candidates sorted by confidence then start time.
 */
export function extractDateTimes(
  text: string,
  options?: { referenceDate?: Date; maxResults?: number }
): ExtractedDateTime[] {
  const reference = options?.referenceDate ?? new Date();
  const maxResults = options?.maxResults ?? 8;
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return [];

  const results = chrono.parse(trimmed, reference, { forwardDate: true });
  const out: ExtractedDateTime[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const startDate = result.start.date();
    if (Number.isNaN(startDate.getTime())) continue;

    const allDay = isAllDayResult(result);
    let endsAt: Date;
    if (result.end) {
      endsAt = result.end.date();
      if (allDay && !result.end.isCertain("hour")) {
        endsAt = defaultEnd(startDate, true);
      }
    } else {
      endsAt = defaultEnd(startDate, allDay);
    }
    if (endsAt < startDate) endsAt = defaultEnd(startDate, allDay);

    const key = `${startDate.toISOString()}|${endsAt.toISOString()}|${allDay}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let confidence = 0.55;
    if (result.start.isCertain("day")) confidence += 0.15;
    if (result.start.isCertain("hour")) confidence += 0.2;
    if (result.end) confidence += 0.05;

    out.push({
      text: result.text,
      startsAt: startDate,
      endsAt,
      allDay,
      confidence: Math.min(1, confidence),
    });
  }

  // Soft boost for ISO-ish fragments chrono may already have caught
  out.sort((a, b) => b.confidence - a.confidence || a.startsAt.getTime() - b.startsAt.getTime());
  return out.slice(0, maxResults);
}

export function suggestTitleFromText(
  text: string,
  matched: string,
  fallback = "Suggested event"
): string {
  const t = titleFromContext(text, matched);
  return t || fallback;
}

export type MessageLike = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type ConfirmedSuggestionCandidate = {
  proposalMessageId: string;
  confirmMessageId: string;
  proposerId: string;
  confirmerId: string;
  extracted: ExtractedDateTime;
  title: string;
  sourceKey: string;
  sourceIds: string[];
};

/**
 * In a chronologically ordered thread: find a date/time in message A, then a
 * later affirmative from a different sender → confirmed suggestion.
 */
export function findConfirmedSuggestionsInThread(
  messages: MessageLike[],
  options?: { referenceDate?: Date; threadSubject?: string }
): ConfirmedSuggestionCandidate[] {
  const reference = options?.referenceDate ?? new Date();
  const ordered = [...messages].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
  const found: ConfirmedSuggestionCandidate[] = [];
  const usedConfirmIds = new Set<string>();

  for (let i = 0; i < ordered.length; i++) {
    const proposal = ordered[i];
    const dates = extractDateTimes(proposal.body, { referenceDate: reference });
    if (dates.length === 0) continue;
    const best = dates[0];

    for (let j = i + 1; j < ordered.length; j++) {
      const reply = ordered[j];
      if (reply.sender_id === proposal.sender_id) continue;
      if (usedConfirmIds.has(reply.id)) continue;
      if (!isAffirmativeReply(reply.body)) continue;

      // Prefer affirmations within ~14 days of the proposal message
      const gapMs =
        new Date(reply.created_at).getTime() -
        new Date(proposal.created_at).getTime();
      if (gapMs < 0 || gapMs > 14 * 24 * 60 * 60 * 1000) continue;

      usedConfirmIds.add(reply.id);
      const title =
        suggestTitleFromText(
          proposal.body,
          best.text,
          options?.threadSubject?.trim() || "Suggested event"
        ) ||
        options?.threadSubject?.trim() ||
        "Suggested event";

      const sourceIds = [proposal.id, reply.id];
      const sourceKey = `msg:${[...sourceIds].sort().join("+")}`;

      found.push({
        proposalMessageId: proposal.id,
        confirmMessageId: reply.id,
        proposerId: proposal.sender_id,
        confirmerId: reply.sender_id,
        extracted: best,
        title: title.slice(0, 200),
        sourceKey,
        sourceIds,
      });
      break;
    }
  }

  return found;
}

/** Extract date chips from document title/description (and optional body text). */
export function extractDocumentDates(args: {
  documentId: string;
  title: string;
  description?: string | null;
  bodyText?: string | null;
  referenceDate?: Date;
}): Array<{
  extracted: ExtractedDateTime;
  title: string;
  sourceKey: string;
  sourceIds: string[];
}> {
  const blob = [args.title, args.description ?? "", args.bodyText ?? ""]
    .filter(Boolean)
    .join("\n");
  const dates = extractDateTimes(blob, {
    referenceDate: args.referenceDate,
    maxResults: 5,
  });
  return dates.map((extracted) => {
    const label =
      args.title.trim().slice(0, 160) ||
      suggestTitleFromText(blob, extracted.text);
    const sourceKey = `doc:${args.documentId}:${extracted.startsAt.toISOString()}`;
    return {
      extracted,
      title: label.slice(0, 200),
      sourceKey,
      sourceIds: [args.documentId],
    };
  });
}
