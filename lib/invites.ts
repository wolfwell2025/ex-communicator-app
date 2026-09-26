import type { SupabaseClient } from "@supabase/supabase-js";
import type { HouseholdInvite, HouseholdInvitePeek } from "./types";

export async function listPendingInvites(
  supabase: SupabaseClient,
  householdId: string
): Promise<{ invites: HouseholdInvite[]; error: string | null }> {
  const { data, error } = await supabase
    .from("household_invites")
    .select(
      "id, household_id, email, email_normalized, token, invited_by, status, created_at, accepted_at, accepted_by, expires_at"
    )
    .eq("household_id", householdId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return { invites: [], error: error.message };
  }
  return { invites: (data ?? []) as HouseholdInvite[], error: null };
}

export async function createHouseholdInvite(
  supabase: SupabaseClient,
  householdId: string,
  email: string
): Promise<{ invite: HouseholdInvite | null; error: string | null }> {
  const { data, error } = await supabase.rpc("create_household_invite", {
    p_household_id: householdId,
    p_email: email.trim(),
  });

  if (error) {
    return { invite: null, error: error.message };
  }

  const invite = (Array.isArray(data) ? data[0] : data) as HouseholdInvite | null;
  return { invite, error: null };
}

export async function revokeHouseholdInvite(
  supabase: SupabaseClient,
  inviteId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("revoke_household_invite", {
    p_invite_id: inviteId,
  });
  return { error: error?.message ?? null };
}

export async function acceptHouseholdInvite(
  supabase: SupabaseClient,
  token: string
): Promise<{ householdId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("accept_household_invite", {
    p_token: token.trim(),
  });

  if (error) {
    return { householdId: null, error: error.message };
  }
  return { householdId: (data as string) ?? null, error: null };
}

export async function peekHouseholdInvite(
  supabase: SupabaseClient,
  token: string
): Promise<{ invite: HouseholdInvitePeek | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_household_invite", {
    p_token: token.trim(),
  });

  if (error) {
    return { invite: null, error: error.message };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | HouseholdInvitePeek
    | null
    | undefined;
  return { invite: row ?? null, error: null };
}

export function inviteAcceptUrl(token: string, siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, "");
  return `${base}/app/invite/${encodeURIComponent(token)}`;
}
