import { NextResponse } from "next/server";
import { inviteAcceptUrl } from "@/lib/invites";
import { sendInviteEmail } from "@/lib/invite-email";
import type { HouseholdInvite } from "@/lib/types";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Body = {
  inviteId?: unknown;
};

/**
 * POST /api/invites/send
 * Body: { inviteId: string }
 *
 * Sends the parenting-team invite email via Resend to the email on the invite
 * row only. Requires an authenticated household member. API key stays server-side.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const inviteId =
    typeof body.inviteId === "string" ? body.inviteId.trim() : "";
  if (!inviteId) {
    return NextResponse.json(
      { error: "Expected { inviteId: string }" },
      { status: 400 }
    );
  }

  const { data: inviteRow, error: inviteErr } = await supabase
    .from("household_invites")
    .select(
      "id, household_id, email, email_normalized, token, invited_by, status, created_at, accepted_at, accepted_by, expires_at"
    )
    .eq("id", inviteId)
    .maybeSingle();

  if (inviteErr) {
    return NextResponse.json({ error: inviteErr.message }, { status: 400 });
  }
  if (!inviteRow) {
    return NextResponse.json(
      { error: "Invite not found or you are not a member of that parenting team." },
      { status: 404 }
    );
  }

  const invite = inviteRow as HouseholdInvite;

  if (invite.status !== "pending") {
    return NextResponse.json(
      { error: "Only pending invites can be emailed." },
      { status: 400 }
    );
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "This invite has expired. Create a new invite." },
      { status: 400 }
    );
  }

  // Defense in depth: only the creator (or any member via RLS select) can trigger.
  // Never accept a client-supplied recipient; always use invite.email.
  const { data: household, error: hhErr } = await supabase
    .from("households")
    .select("id, name")
    .eq("id", invite.household_id)
    .maybeSingle();

  if (hhErr || !household) {
    return NextResponse.json(
      { error: hhErr?.message ?? "Parenting team not found." },
      { status: 400 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const inviterDisplayName =
    profile?.display_name?.trim() ||
    profile?.email?.trim() ||
    user.email?.trim() ||
    "A co-parent";

  const acceptUrl = inviteAcceptUrl(invite.token, getSiteUrl());

  const result = await sendInviteEmail(
    {
      to: invite.email,
      inviterDisplayName,
      parentingTeamName: (household.name as string) || "Parenting team",
      acceptUrl,
      expiresAt: invite.expires_at,
    },
    { idempotencyKey: `invite-email-${invite.id}` }
  );

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        inviteId: invite.id,
        email: invite.email,
        acceptUrl,
        emailed: false,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    emailed: true,
    inviteId: invite.id,
    email: invite.email,
    acceptUrl,
    resendId: result.id,
  });
}
