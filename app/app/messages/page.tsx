import { redirect } from "next/navigation";
import { MessagesPanel } from "@/components/messages/messages-panel";
import { ensureHousehold } from "@/lib/households";
import { listHouseholdMembers, listThreads } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function one(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function MessagesPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
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
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Messages
        </h1>
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-5 text-sm text-danger">
          Could not load or create your parenting team
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

  const [
    { threads, error: threadsError, needsMigration },
    { members, error: membersError },
  ] = await Promise.all([
    listThreads(supabase, household.id),
    listHouseholdMembers(supabase, household.id),
  ]);

  const loadError = threadsError && !needsMigration ? threadsError : membersError;

  const draftSubject = one(params.subject) ?? null;
  const draftBody = one(params.body) ?? null;
  const openNew =
    one(params.new) === "1" ||
    one(params.new) === "true" ||
    Boolean(draftSubject || draftBody);

  return (
    <div className="space-y-4">
      {loadError ? (
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-4 text-sm text-danger">
          Could not load messages: {loadError}
        </p>
      ) : null}
      <MessagesPanel
        householdId={household.id}
        householdName={household.name}
        userId={user.id}
        initialThreads={threads}
        initialMembers={members}
        needsMigration={needsMigration}
        draftSubject={draftSubject}
        draftBody={draftBody}
        openNewComposer={openNew}
      />
    </div>
  );
}
