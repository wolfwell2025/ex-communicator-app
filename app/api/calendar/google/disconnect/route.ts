import { NextResponse } from "next/server";
import { disconnectCalendarConnection } from "@/lib/google-calendar";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { connectionId?: string; removeImportedEvents?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.connectionId) {
    return NextResponse.json(
      { error: "connectionId required" },
      { status: 400 }
    );
  }

  const { error } = await disconnectCalendarConnection({
    supabase,
    userId: user.id,
    connectionId: body.connectionId,
    removeImportedEvents: Boolean(body.removeImportedEvents),
  });

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
