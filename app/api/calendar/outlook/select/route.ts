import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  pendingOutlookFromConnection,
  saveOutlookCalendarConnection,
  syncOutlookCalendarEvents,
  type PendingOutlookAuth,
} from "@/lib/outlook-calendar";
import {
  OUTLOOK_PENDING_COOKIE,
  parseOutlookPendingCookie,
} from "@/lib/outlook-pending-cookie";
import { ensureHousehold } from "@/lib/households";
import { createClient } from "@/lib/supabase/server";

type SelectBody = {
  calendars: Array<{
    id: string;
    summary: string;
    label?: string;
  }>;
  fromConnection?: string;
  syncNow?: boolean;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SelectBody;
  try {
    body = (await request.json()) as SelectBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.calendars?.length) {
    return NextResponse.json(
      { error: "Select at least one calendar." },
      { status: 400 }
    );
  }

  let pending: PendingOutlookAuth | null = null;

  if (body.fromConnection) {
    const result = await pendingOutlookFromConnection(
      supabase,
      user.id,
      body.fromConnection
    );
    if (result.error || !result.pending) {
      return NextResponse.json(
        { error: result.error || "Could not reuse connection" },
        { status: 400 }
      );
    }
    pending = result.pending;
  } else {
    const jar = await cookies();
    pending = parseOutlookPendingCookie(
      jar.get(OUTLOOK_PENDING_COOKIE)?.value
    );
    if (!pending) {
      return NextResponse.json(
        { error: "No pending Outlook auth. Connect Outlook first." },
        { status: 400 }
      );
    }
  }

  const { household, error: hhErr } = await ensureHousehold(supabase);
  if (hhErr || !household) {
    return NextResponse.json(
      { error: hhErr || "No parenting team" },
      { status: 400 }
    );
  }

  const connectionIds: string[] = [];
  const errors: string[] = [];

  for (const cal of body.calendars) {
    const { connectionId, error } = await saveOutlookCalendarConnection({
      supabase,
      userId: user.id,
      pending,
      calendarId: cal.id,
      calendarSummary: cal.summary,
      label: cal.label || cal.summary,
      syncEnabled: true,
    });
    if (error || !connectionId) {
      errors.push(error || `Failed to save ${cal.summary}`);
      continue;
    }
    connectionIds.push(connectionId);

    if (body.syncNow !== false) {
      const sync = await syncOutlookCalendarEvents({
        supabase,
        userId: user.id,
        householdId: household.id,
        connectionId,
      });
      if (sync.error) errors.push(sync.error);
    }
  }

  const res = NextResponse.json({
    connectionIds,
    errors,
    privacyNote:
      "Imported events are private to you. Propose individually when you want your co-parent to see them.",
  });
  if (!body.fromConnection) {
    res.cookies.set(OUTLOOK_PENDING_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}
