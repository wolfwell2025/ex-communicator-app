import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  listOutlookCalendars,
  pendingOutlookFromConnection,
} from "@/lib/outlook-calendar";
import {
  OUTLOOK_PENDING_COOKIE,
  parseOutlookPendingCookie,
} from "@/lib/outlook-pending-cookie";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const fromConnection = searchParams.get("fromConnection");

  let accessToken: string | null = null;
  let email: string | null = null;

  if (fromConnection) {
    const { pending, error } = await pendingOutlookFromConnection(
      supabase,
      user.id,
      fromConnection
    );
    if (error || !pending) {
      return NextResponse.json(
        { error: error || "Could not reuse connection tokens" },
        { status: 400 }
      );
    }
    accessToken = pending.accessToken;
    email = pending.email;
  } else {
    const jar = await cookies();
    const pending = parseOutlookPendingCookie(
      jar.get(OUTLOOK_PENDING_COOKIE)?.value
    );
    if (!pending) {
      return NextResponse.json(
        { error: "No pending Outlook auth. Connect Outlook first." },
        { status: 400 }
      );
    }
    accessToken = pending.accessToken;
    email = pending.email;
  }

  try {
    const calendars = await listOutlookCalendars(accessToken!);
    const { data: existing } = await supabase
      .from("personal_calendar_connections")
      .select("external_calendar_id, external_account_email")
      .eq("user_id", user.id)
      .eq("provider", "outlook")
      .eq("status", "connected");

    const linked = new Set(
      (existing ?? [])
        .filter((e) => !email || e.external_account_email === email)
        .map((e) => e.external_calendar_id as string)
    );

    return NextResponse.json({
      email,
      calendars: calendars.map((c) => ({
        ...c,
        alreadyConnected: linked.has(c.id),
      })),
      privacyNote:
        "Connecting imports events as private only. Your co-parent never sees them until you propose and they accept in-app.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list calendars" },
      { status: 502 }
    );
  }
}
