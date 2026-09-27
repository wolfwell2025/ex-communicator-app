import { NextResponse } from "next/server";
import {
  buildDraftFromEmail,
  getEmailThreadWithMessages,
} from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

/**
 * Build an in-app Messages draft grounded in a private email thread.
 * Does NOT send external email and does NOT auto-share the mailbox content.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { threadId?: string; messageId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.threadId) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  }

  const result = await getEmailThreadWithMessages(
    supabase,
    user.id,
    body.threadId
  );
  if (result.error || !result.thread) {
    return NextResponse.json(
      { error: result.error || "Thread not found" },
      { status: 404 }
    );
  }

  const messages = result.messages;
  const picked =
    (body.messageId
      ? messages.find((m) => m.id === body.messageId)
      : null) ||
    messages.filter((m) => !m.is_from_me).slice(-1)[0] ||
    messages.slice(-1)[0] ||
    null;

  const draft = buildDraftFromEmail({
    subject: picked?.subject || result.thread.subject,
    fromAddr: picked?.from_addr || null,
    sentAt: picked?.sent_at || result.thread.last_message_at,
    bodyOrSnippet:
      picked?.body_text ||
      picked?.snippet ||
      result.thread.snippet ||
      null,
    provider: result.thread.provider,
  });

  return NextResponse.json({
    subject: draft.subject,
    body: draft.body,
    threadId: result.thread.id,
    privacyNote:
      "Only the draft text you send in Messages is shared with the parenting team. The original mailbox stays private.",
    messagesPath: `/app/messages?new=1&subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`,
  });
}
