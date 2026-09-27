import { NextResponse } from "next/server";
import { disconnectEmailConnection } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { connectionId?: string; removeImported?: boolean };
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

  // Ensure it is a gmail connection owned by user
  const { data: conn } = await supabase
    .from("email_connections")
    .select("id, provider")
    .eq("id", body.connectionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!conn || conn.provider !== "gmail") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const { error } = await disconnectEmailConnection({
    supabase,
    userId: user.id,
    connectionId: body.connectionId,
    removeImported: body.removeImported !== false,
  });

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
