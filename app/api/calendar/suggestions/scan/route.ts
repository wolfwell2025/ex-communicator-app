import { NextResponse } from "next/server";
import { scanThreadForSuggestions } from "@/lib/calendar-suggestions";
import { ensureHousehold } from "@/lib/households";
import { createClient } from "@/lib/supabase/server";

/**
 * Scan a message thread for confirmed date/time proposals and persist
 * calendar_suggestions for confirmer (+ proposer).
 * Body: { threadId: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { household, error: hhErr } = await ensureHousehold(supabase);
  if (hhErr || !household) {
    return NextResponse.json(
      { error: hhErr || "No household" },
      { status: 400 }
    );
  }

  let body: { threadId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.threadId) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  }

  // Confirm caller can see the thread (participant or household member via RLS)
  const { data: thread, error: threadErr } = await supabase
    .from("message_threads")
    .select("id, household_id, subject")
    .eq("id", body.threadId)
    .eq("household_id", household.id)
    .maybeSingle();

  if (threadErr || !thread) {
    return NextResponse.json(
      { error: threadErr?.message || "Thread not found" },
      { status: 404 }
    );
  }

  const { created, error } = await scanThreadForSuggestions(supabase, {
    householdId: household.id,
    threadId: body.threadId,
    threadSubject: thread.subject,
  });

  if (error) {
    const needsMigration =
      error.toLowerCase().includes("calendar_suggestions") ||
      error.toLowerCase().includes("schema cache");
    return NextResponse.json(
      { created: 0, error, needsMigration },
      { status: needsMigration ? 200 : 400 }
    );
  }

  return NextResponse.json({ created });
}
