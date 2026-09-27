import { NextResponse } from "next/server";
import {
  setOutlookConnectionExportEnabled,
  setOutlookConnectionSyncEnabled,
  updateOutlookConnectionLabel,
} from "@/lib/outlook-calendar";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    connectionId?: string;
    syncEnabled?: boolean;
    exportEnabled?: boolean;
    label?: string;
  };
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

  if (typeof body.syncEnabled === "boolean") {
    const { error } = await setOutlookConnectionSyncEnabled({
      supabase,
      userId: user.id,
      connectionId: body.connectionId,
      syncEnabled: body.syncEnabled,
    });
    if (error) return NextResponse.json({ error }, { status: 400 });
  }

  if (typeof body.exportEnabled === "boolean") {
    const { error } = await setOutlookConnectionExportEnabled({
      supabase,
      userId: user.id,
      connectionId: body.connectionId,
      exportEnabled: body.exportEnabled,
    });
    if (error) return NextResponse.json({ error }, { status: 400 });
  }

  if (typeof body.label === "string") {
    const { error } = await updateOutlookConnectionLabel({
      supabase,
      userId: user.id,
      connectionId: body.connectionId,
      label: body.label,
    });
    if (error) return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
