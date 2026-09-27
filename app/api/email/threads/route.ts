import { NextResponse } from "next/server";
import {
  getEmailThreadWithMessages,
  listEmailThreads,
} from "@/lib/email";
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
  const threadId = searchParams.get("id");

  if (threadId) {
    const result = await getEmailThreadWithMessages(
      supabase,
      user.id,
      threadId
    );
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      thread: result.thread,
      messages: result.messages,
      privacyNote:
        "This email is private to you. Drafting into Messages shares only the text you choose to send.",
    });
  }

  const result = await listEmailThreads(supabase, user.id);
  if (result.error) {
    return NextResponse.json(
      { error: result.error, needsMigration: result.needsMigration },
      { status: 400 }
    );
  }
  return NextResponse.json({
    threads: result.threads,
    privacyNote:
      "Imported email is private until you draft a message for the parenting team.",
  });
}
