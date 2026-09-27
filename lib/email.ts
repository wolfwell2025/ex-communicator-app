import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EmailConnection,
  EmailMessage,
  EmailThread,
  EmailThreadListItem,
  EmailThreadParticipant,
} from "./types";

const CONNECTION_PUBLIC_COLS =
  "id, user_id, provider, status, sync_enabled, external_account_email, scopes, last_synced_at, last_error, created_at, updated_at";

function isMissingEmailSchema(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("email_connections") ||
    m.includes("email_threads") ||
    m.includes("email_messages") ||
    m.includes("could not find the table") ||
    m.includes("schema cache")
  );
}

function parseParticipants(raw: unknown): EmailThreadParticipant[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailThreadParticipant[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const email = String(
      (item as { email?: unknown }).email ?? ""
    ).trim();
    if (!email) continue;
    const nameRaw = (item as { name?: unknown }).name;
    out.push({
      email,
      name:
        typeof nameRaw === "string" && nameRaw.trim()
          ? nameRaw.trim()
          : null,
    });
  }
  return out;
}

export async function listEmailConnections(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  connections: EmailConnection[];
  error: string | null;
  needsMigration: boolean;
}> {
  const { data, error } = await supabase
    .from("email_connections")
    .select(CONNECTION_PUBLIC_COLS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    return {
      connections: [],
      error: error.message,
      needsMigration: isMissingEmailSchema(error.message),
    };
  }

  return {
    connections: (data ?? []) as EmailConnection[],
    error: null,
    needsMigration: false,
  };
}

export async function listEmailThreads(
  supabase: SupabaseClient,
  userId: string,
  limit = 50
): Promise<{
  threads: EmailThreadListItem[];
  error: string | null;
  needsMigration: boolean;
}> {
  const { data, error } = await supabase
    .from("email_threads")
    .select(
      "id, connection_id, user_id, provider, external_thread_id, subject, snippet, participants, last_message_at, message_count, is_unread, created_at, updated_at"
    )
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    return {
      threads: [],
      error: error.message,
      needsMigration: isMissingEmailSchema(error.message),
    };
  }

  const rows = data ?? [];
  const connectionIds = [
    ...new Set(rows.map((r) => r.connection_id as string).filter(Boolean)),
  ];
  const emailByConnection = new Map<string, string | null>();
  if (connectionIds.length > 0) {
    const { data: conns } = await supabase
      .from("email_connections")
      .select("id, external_account_email")
      .eq("user_id", userId)
      .in("id", connectionIds);
    for (const c of conns ?? []) {
      emailByConnection.set(c.id, c.external_account_email);
    }
  }

  const threads: EmailThreadListItem[] = rows.map((r) => ({
    id: r.id,
    connection_id: r.connection_id,
    user_id: r.user_id,
    provider: r.provider,
    external_thread_id: r.external_thread_id,
    subject: r.subject,
    snippet: r.snippet,
    participants: parseParticipants(r.participants),
    last_message_at: r.last_message_at,
    message_count: r.message_count ?? 0,
    is_unread: Boolean(r.is_unread),
    created_at: r.created_at,
    updated_at: r.updated_at,
    account_email: emailByConnection.get(r.connection_id) ?? null,
  }));

  return { threads, error: null, needsMigration: false };
}

export async function getEmailThreadWithMessages(
  supabase: SupabaseClient,
  userId: string,
  threadId: string
): Promise<{
  thread: EmailThreadListItem | null;
  messages: EmailMessage[];
  error: string | null;
}> {
  const { data: threadRow, error: threadErr } = await supabase
    .from("email_threads")
    .select(
      "id, connection_id, user_id, provider, external_thread_id, subject, snippet, participants, last_message_at, message_count, is_unread, created_at, updated_at"
    )
    .eq("user_id", userId)
    .eq("id", threadId)
    .maybeSingle();

  if (threadErr) {
    return { thread: null, messages: [], error: threadErr.message };
  }
  if (!threadRow) {
    return { thread: null, messages: [], error: "Thread not found" };
  }

  const { data: conn } = await supabase
    .from("email_connections")
    .select("external_account_email")
    .eq("id", threadRow.connection_id)
    .eq("user_id", userId)
    .maybeSingle();

  const { data: messageRows, error: msgErr } = await supabase
    .from("email_messages")
    .select(
      "id, thread_id, connection_id, user_id, provider, external_message_id, from_addr, to_addrs, cc_addrs, subject, body_text, snippet, sent_at, is_from_me, created_at, updated_at"
    )
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: true, nullsFirst: false });

  if (msgErr) {
    return { thread: null, messages: [], error: msgErr.message };
  }

  const thread: EmailThreadListItem = {
    ...(threadRow as EmailThread),
    participants: parseParticipants(threadRow.participants),
    account_email: conn?.external_account_email ?? null,
  };

  return {
    thread,
    messages: (messageRows ?? []) as EmailMessage[],
    error: null,
  };
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
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

/**
 * Build a calm in-app message draft grounded in a private email thread.
 * Does NOT send external email. User must edit and send in Messages.
 */
export function buildDraftFromEmail(args: {
  subject: string | null;
  fromAddr: string | null;
  sentAt: string | null;
  bodyOrSnippet: string | null;
  provider: "gmail" | "outlook";
}): { subject: string; body: string } {
  const providerLabel = args.provider === "gmail" ? "Gmail" : "Outlook";
  const emailSubject = (args.subject || "(no subject)").trim();
  const when = formatWhen(args.sentAt);
  const excerpt = clip(args.bodyOrSnippet || "", 500);

  const subject = emailSubject.toLowerCase().startsWith("re:")
    ? emailSubject
    : `Re: ${emailSubject}`;

  const lines = [
    `Hi - looping this into our parenting team thread.`,
    "",
    `I received an email (${providerLabel}) about: ${emailSubject}.`,
  ];
  if (args.fromAddr?.trim()) {
    lines.push(`From: ${args.fromAddr.trim()}`);
  }
  if (when) {
    lines.push(`Date: ${when}`);
  }
  if (excerpt) {
    lines.push("", `Summary of what it said:`, excerpt);
  }
  lines.push(
    "",
    "Wanted you to have the same facts. Happy to discuss next steps here."
  );

  return { subject, body: lines.join("\n") };
}

export async function disconnectEmailConnection(args: {
  supabase: SupabaseClient;
  userId: string;
  connectionId: string;
  removeImported?: boolean;
}): Promise<{ error: string | null }> {
  const { data: conn, error: findErr } = await args.supabase
    .from("email_connections")
    .select("id")
    .eq("id", args.connectionId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (findErr) return { error: findErr.message };
  if (!conn) return { error: "Connection not found" };

  if (args.removeImported !== false) {
    // Cascades via FK, but delete threads first for clarity
    await args.supabase
      .from("email_threads")
      .delete()
      .eq("connection_id", args.connectionId)
      .eq("user_id", args.userId);
  }

  const { error } = await args.supabase
    .from("email_connections")
    .delete()
    .eq("id", args.connectionId)
    .eq("user_id", args.userId);

  return { error: error?.message ?? null };
}
