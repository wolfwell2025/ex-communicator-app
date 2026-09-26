import { redirect } from "next/navigation";
import { MessagesPanel } from "@/components/messages/messages-panel";
import { ensureHousehold, listMessages } from "@/lib/households";
import { createClient } from "@/lib/supabase/server";

export default async function MessagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/app/messages");
  }

  const { household, error: householdError } = await ensureHousehold(supabase);

  if (householdError || !household) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Messages
        </h1>
        <p className="rounded-xl border border-red-200 bg-danger-soft p-4 text-sm text-danger">
          Could not load or create your household
          {householdError ? `: ${householdError}` : "."} If this is the first
          run, paste{" "}
          <code className="rounded-md border border-red-200 bg-white px-1.5 py-0.5 text-xs text-foreground">
            supabase/migrations/001_households_messages.sql
          </code>{" "}
          into the Supabase SQL Editor and try again.
        </p>
      </div>
    );
  }

  const { messages, error: messagesError } = await listMessages(
    supabase,
    household.id
  );

  return (
    <div className="space-y-3">
      {messagesError ? (
        <p className="rounded-xl border border-red-200 bg-danger-soft p-3.5 text-sm text-danger">
          Could not load messages: {messagesError}
        </p>
      ) : null}
      <MessagesPanel
        householdId={household.id}
        householdName={household.name}
        userId={user.id}
        initialMessages={messages}
      />
    </div>
  );
}
