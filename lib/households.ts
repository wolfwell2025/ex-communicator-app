import type { SupabaseClient } from "@supabase/supabase-js";
import type { Household, MessageWithSender, Profile } from "./types";

type EnsureResult = {
  household: Household | null;
  profile: Profile | null;
  error: string | null;
};

/** Ensure profile row exists, then return the user's first household (creating one if needed). */
export async function ensureHousehold(
  supabase: SupabaseClient,
  options?: { name?: string }
): Promise<EnsureResult> {
  const { data: profileData, error: profileError } = await supabase.rpc(
    "ensure_profile"
  );

  if (profileError) {
    return { household: null, profile: null, error: profileError.message };
  }

  const profile = (Array.isArray(profileData) ? profileData[0] : profileData) as
    | Profile
    | null;

  const { data: memberships, error: memberError } = await supabase
    .from("household_members")
    .select("household_id, households ( id, name, created_by, created_at )");

  if (memberError) {
    return { household: null, profile, error: memberError.message };
  }

  type MembershipRow = {
    household_id: string;
    households: Household | Household[] | null;
  };

  const rows = (memberships ?? []) as MembershipRow[];

  if (rows.length > 0) {
    // Prefer a household that already has another member (shared co-parent home)
    const counts = await Promise.all(
      rows.map(async (row) => {
        const { count } = await supabase
          .from("household_members")
          .select("*", { count: "exact", head: true })
          .eq("household_id", row.household_id);
        return { row, count: count ?? 0 };
      })
    );
    counts.sort((a, b) => b.count - a.count);
    const chosen = counts[0]?.row;
    if (chosen?.households) {
      const household = Array.isArray(chosen.households)
        ? chosen.households[0]
        : chosen.households;
      if (household) {
        return { household, profile, error: null };
      }
    }
  }

  const { data: householdId, error: createError } = await supabase.rpc(
    "create_household",
    { p_name: options?.name ?? "Our household" }
  );

  if (createError || !householdId) {
    return {
      household: null,
      profile,
      error: createError?.message ?? "Could not create household",
    };
  }

  const { data: household, error: fetchError } = await supabase
    .from("households")
    .select("id, name, created_by, created_at")
    .eq("id", householdId)
    .single();

  if (fetchError || !household) {
    return {
      household: null,
      profile,
      error: fetchError?.message ?? "Household created but could not be loaded",
    };
  }

  return { household: household as Household, profile, error: null };
}

export async function listMessages(
  supabase: SupabaseClient,
  householdId: string
): Promise<{ messages: MessageWithSender[]; error: string | null }> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, household_id, sender_id, body, created_at")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });

  if (error) {
    return { messages: [], error: error.message };
  }

  const rows = data ?? [];
  const senderIds = [...new Set(rows.map((r) => r.sender_id))];

  const profilesById: Record<
    string,
    { email: string | null; display_name: string | null }
  > = {};

  if (senderIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, display_name")
      .in("id", senderIds);

    for (const p of profiles ?? []) {
      profilesById[p.id] = { email: p.email, display_name: p.display_name };
    }
  }

  const messages: MessageWithSender[] = rows.map((row) => ({
    ...row,
    sender_email: profilesById[row.sender_id]?.email ?? null,
    sender_display_name: profilesById[row.sender_id]?.display_name ?? null,
  }));

  return { messages, error: null };
}

export function formatTranscript(
  messages: MessageWithSender[],
  householdName: string
): string {
  const lines: string[] = [
    "Ex Communicator export",
    `Household: ${householdName}`,
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
