import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  HouseholdMemberProfile,
  MessageThread,
  MessageWithSender,
  ThreadListItem,
} from "./types";

type ProfilesMap = Record<
  string,
  { email: string | null; display_name: string | null }
>;

async function loadProfiles(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<ProfilesMap> {
  const profilesById: ProfilesMap = {};
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return profilesById;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .in("id", unique);

  for (const p of profiles ?? []) {
    profilesById[p.id] = { email: p.email, display_name: p.display_name };
  }
  return profilesById;
}

function labelFor(
  profilesById: ProfilesMap,
  userId: string
): { email: string | null; display_name: string | null } {
  return profilesById[userId] ?? { email: null, display_name: null };
}

export function memberLabel(m: {
  email: string | null;
  display_name: string | null;
  user_id?: string;
}): string {
  return m.display_name?.trim() || m.email?.trim() || m.user_id || "Unknown";
}

/** List household members with profile labels (for To: picker). */
export async function listHouseholdMembers(
  supabase: SupabaseClient,
  householdId: string
): Promise<{ members: HouseholdMemberProfile[]; error: string | null }> {
  const { data, error } = await supabase
    .from("household_members")
    .select("user_id, role, created_at")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });

  if (error) {
    return { members: [], error: error.message };
  }

  const rows = data ?? [];
  const profilesById = await loadProfiles(
    supabase,
    rows.map((r) => r.user_id)
  );

  const members: HouseholdMemberProfile[] = rows.map((r) => ({
    user_id: r.user_id,
    role: r.role as HouseholdMemberProfile["role"],
    email: labelFor(profilesById, r.user_id).email,
    display_name: labelFor(profilesById, r.user_id).display_name,
  }));

  return { members, error: null };
}

function isMissingThreadsSchema(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("message_threads") ||
    m.includes("thread_participants") ||
    m.includes("thread_id") ||
    m.includes("could not find the table") ||
    m.includes("schema cache")
  );
}

export async function listThreads(
  supabase: SupabaseClient,
  householdId: string
): Promise<{
  threads: ThreadListItem[];
  error: string | null;
  needsMigration: boolean;
}> {
  const { data: threadRows, error } = await supabase
    .from("message_threads")
    .select("id, household_id, subject, created_by, created_at, updated_at")
    .eq("household_id", householdId)
    .order("updated_at", { ascending: false });

  if (error) {
    return {
      threads: [],
      error: error.message,
      needsMigration: isMissingThreadsSchema(error.message),
    };
  }

  const threads = (threadRows ?? []) as MessageThread[];
  if (threads.length === 0) {
    return { threads: [], error: null, needsMigration: false };
  }

  const threadIds = threads.map((t) => t.id);

  const { data: participantRows } = await supabase
    .from("thread_participants")
    .select("thread_id, user_id, created_at")
    .in("thread_id", threadIds);

  const { data: messageRows } = await supabase
    .from("messages")
    .select("id, household_id, sender_id, body, created_at, thread_id")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false });

  const allUserIds = [
    ...new Set([
      ...(participantRows ?? []).map((p) => p.user_id),
      ...(messageRows ?? []).map((m) => m.sender_id),
      ...threads.map((t) => t.created_by),
    ]),
  ];
  const profilesById = await loadProfiles(supabase, allUserIds);

  // role map not needed for list display; use "parent" placeholder when unknown
  const participantsByThread = new Map<string, HouseholdMemberProfile[]>();
  for (const p of participantRows ?? []) {
    const list = participantsByThread.get(p.thread_id) ?? [];
    const profile = labelFor(profilesById, p.user_id);
    list.push({
      user_id: p.user_id,
      role: "parent",
      email: profile.email,
      display_name: profile.display_name,
    });
    participantsByThread.set(p.thread_id, list);
  }

  const lastByThread = new Map<string, MessageWithSender>();
  const countByThread = new Map<string, number>();
  const searchByThread = new Map<string, string[]>();
  for (const row of messageRows ?? []) {
    if (!row.thread_id) continue;
    countByThread.set(
      row.thread_id,
      (countByThread.get(row.thread_id) ?? 0) + 1
    );
    const blobs = searchByThread.get(row.thread_id) ?? [];
    blobs.push(row.body.toLowerCase());
    searchByThread.set(row.thread_id, blobs);
    if (!lastByThread.has(row.thread_id)) {
      const profile = labelFor(profilesById, row.sender_id);
      lastByThread.set(row.thread_id, {
        ...row,
        sender_email: profile.email,
        sender_display_name: profile.display_name,
      });
    }
  }

  const items: ThreadListItem[] = threads.map((t) => ({
    ...t,
    participants: participantsByThread.get(t.id) ?? [],
    last_message: lastByThread.get(t.id) ?? null,
    message_count: countByThread.get(t.id) ?? 0,
    search_text: (searchByThread.get(t.id) ?? []).join("\n"),
  }));

  return { threads: items, error: null, needsMigration: false };
}

export async function listThreadMessages(
  supabase: SupabaseClient,
  threadId: string
): Promise<{ messages: MessageWithSender[]; error: string | null }> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, household_id, sender_id, body, created_at, thread_id")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) {
    return { messages: [], error: error.message };
  }

  const rows = data ?? [];
  const profilesById = await loadProfiles(
    supabase,
    rows.map((r) => r.sender_id)
  );

  const messages: MessageWithSender[] = rows.map((row) => {
    const profile = labelFor(profilesById, row.sender_id);
    return {
      ...row,
      sender_email: profile.email,
      sender_display_name: profile.display_name,
    };
  });

  return { messages, error: null };
}

export async function createThread(
  supabase: SupabaseClient,
  args: {
    householdId: string;
    subject: string;
    participantIds: string[];
    body: string;
  }
): Promise<{ threadId: string | null; error: string | null; needsMigration: boolean }> {
  const { data, error } = await supabase.rpc("create_message_thread", {
    p_household_id: args.householdId,
    p_subject: args.subject.trim(),
    p_participant_ids: args.participantIds,
    p_body: args.body.trim(),
  });

  if (error) {
    return {
      threadId: null,
      error: error.message,
      needsMigration: isMissingThreadsSchema(error.message),
    };
  }

  return {
    threadId: (data as string) ?? null,
    error: null,
    needsMigration: false,
  };
}

export async function sendThreadReply(
  supabase: SupabaseClient,
  args: {
    householdId: string;
    threadId: string;
    userId: string;
    body: string;
  }
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("messages").insert({
    household_id: args.householdId,
    sender_id: args.userId,
    body: args.body.trim(),
    thread_id: args.threadId,
  });

  return { error: error?.message ?? null };
}

export function formatThreadTranscript(
  thread: { subject: string },
  messages: MessageWithSender[],
  householdName: string
): string {
  const lines: string[] = [
    "Ex Communicator export",
    `Household: ${householdName}`,
    `Subject: ${thread.subject}`,
    `Exported: ${new Date().toISOString()}`,
    "----------------------------------------",
    "",
  ];

  for (const m of messages) {
    const who = m.sender_email ?? m.sender_display_name ?? m.sender_id;
    lines.push(`[${m.created_at}] ${who}`);
    lines.push(m.body);
    lines.push("");
  }

  lines.push("----------------------------------------");
  lines.push("Ex Communicator export");
  return lines.join("\n");
}

/** Client-side filter for thread list search. */
export function filterThreads(
  threads: ThreadListItem[],
  query: string,
  currentUserId: string
): ThreadListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return threads;

  return threads.filter((t) => {
    if (t.subject.toLowerCase().includes(q)) return true;
    if (t.search_text.includes(q)) return true;
    if (t.last_message?.body.toLowerCase().includes(q)) return true;
    for (const p of t.participants) {
      if (p.user_id === currentUserId) continue;
      const label = memberLabel(p).toLowerCase();
      if (label.includes(q)) return true;
      if (p.email?.toLowerCase().includes(q)) return true;
    }
    return false;
  });
}
