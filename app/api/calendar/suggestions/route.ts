import { NextResponse } from "next/server";
import {
  acceptSuggestion,
  dismissSuggestion,
  listPendingSuggestions,
} from "@/lib/calendar-suggestions";
import { exportEventById } from "@/lib/google-calendar";
import { ensureHousehold } from "@/lib/households";
import { createClient } from "@/lib/supabase/server";

/** GET pending suggestions for the current user in their household. */
export async function GET() {
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

  const { suggestions, error } = await listPendingSuggestions(supabase, {
    householdId: household.id,
    userId: user.id,
  });
  if (error) {
    // Table may not exist until John runs migration 007
    return NextResponse.json({ suggestions: [], error, needsMigration: true });
  }
  return NextResponse.json({ suggestions });
}

/**
 * POST { action: 'accept'|'dismiss', suggestionId, visibility?: 'private'|'pending' }
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

  let body: {
    action?: string;
    suggestionId?: string;
    visibility?: "private" | "pending";
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.suggestionId || !body.action) {
    return NextResponse.json(
      { error: "suggestionId and action required" },
      { status: 400 }
    );
  }

  if (body.action === "dismiss") {
    const { error } = await dismissSuggestion(supabase, {
      suggestionId: body.suggestionId,
      userId: user.id,
    });
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "accept") {
    const visibility = body.visibility === "pending" ? "pending" : "private";
    const { eventId, error } = await acceptSuggestion(supabase, {
      suggestionId: body.suggestionId,
      userId: user.id,
      householdId: household.id,
      visibility,
    });
    if (error && !eventId) {
      return NextResponse.json({ error }, { status: 400 });
    }
    if (eventId) {
      // Best-effort Google export if opted in
      void exportEventById({
        supabase,
        userId: user.id,
        eventId,
      });
    }
    return NextResponse.json({ ok: true, eventId, error: error ?? null });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
