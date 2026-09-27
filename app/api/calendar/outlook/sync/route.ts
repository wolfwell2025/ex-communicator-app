import { NextResponse } from "next/server";
import {
  syncAllEnabledOutlookCalendars,
  syncOutlookCalendarEvents,
} from "@/lib/outlook-calendar";
import { ensureHousehold } from "@/lib/households";
import { createClient } from "@/lib/supabase/server";

/**
 * Sync one or all enabled Outlook calendars.
 * Imports are always private - never shared with co-parent automatically.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { connectionId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // empty body = sync all
  }

  const { household, error: hhErr } = await ensureHousehold(supabase);
  if (hhErr || !household) {
    return NextResponse.json(
      { error: hhErr || "No parenting team" },
      { status: 400 }
    );
  }

  if (body.connectionId) {
    const result = await syncOutlookCalendarEvents({
      supabase,
      userId: user.id,
      householdId: household.id,
      connectionId: body.connectionId,
    });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      imported: result.imported,
      privacyNote:
        "Synced events stay private until you propose them to the parenting team.",
    });
  }

  const result = await syncAllEnabledOutlookCalendars({
    supabase,
    userId: user.id,
    householdId: household.id,
  });
  return NextResponse.json({
    imported: result.imported,
    errors: result.errors,
    privacyNote:
      "Synced events stay private until you propose them to the parenting team.",
  });
}
