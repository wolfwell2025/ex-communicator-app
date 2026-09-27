import { NextResponse } from "next/server";
import {
  syncAllOutlookMailConnections,
  syncOutlookMailConnection,
} from "@/lib/outlook-mail";
import { createClient } from "@/lib/supabase/server";

/**
 * Sync Outlook mail. Imports stay private to the connecting user.
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
    // empty = sync all
  }

  if (body.connectionId) {
    const result = await syncOutlookMailConnection({
      supabase,
      userId: user.id,
      connectionId: body.connectionId,
    });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      imported: result.imported,
      privacyNote:
        "Synced email stays private until you draft a message for the parenting team.",
    });
  }

  const result = await syncAllOutlookMailConnections({
    supabase,
    userId: user.id,
  });
  return NextResponse.json({
    imported: result.imported,
    errors: result.errors,
    privacyNote:
      "Synced email stays private until you draft a message for the parenting team.",
  });
}
