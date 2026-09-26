import { NextResponse } from "next/server";
import {
  deleteExportedGoogleEvent,
  exportEventById,
} from "@/lib/google-calendar";
import { createClient } from "@/lib/supabase/server";

/**
 * Push or delete an app event on Google when export_enabled is on.
 * Body: { eventId: string, action?: 'upsert' | 'delete' }
 * For delete, the local event must still exist (call before local delete).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { eventId?: string; action?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const action = body.action === "delete" ? "delete" : "upsert";

  if (action === "delete") {
    const { data: event, error } = await supabase
      .from("calendar_events")
      .select("external_id, connection_id, created_by, source")
      .eq("id", body.eventId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!event) return NextResponse.json({ ok: true });
    const result = await deleteExportedGoogleEvent({
      supabase,
      userId: user.id,
      event,
    });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  const result = await exportEventById({
    supabase,
    userId: user.id,
    eventId: body.eventId,
  });
  if (result.error && result.exported === 0) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    exported: result.exported,
    error: result.error,
  });
}
