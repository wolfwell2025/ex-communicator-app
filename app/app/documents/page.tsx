import { redirect } from "next/navigation";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { listDocuments } from "@/lib/documents";
import { ensureHousehold } from "@/lib/households";
import { createClient } from "@/lib/supabase/server";

export default async function DocumentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/app/documents");
  }

  const { household, error: householdError } = await ensureHousehold(supabase);

  if (householdError || !household) {
    return (
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Documents
        </h1>
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-5 text-sm text-danger">
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

  const { documents, error: docsError } = await listDocuments(
    supabase,
    household.id
  );

  const migrationHint =
    docsError &&
    /documents|does not exist|schema cache|Could not find/i.test(docsError);

  return (
    <div className="space-y-4">
      {docsError ? (
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-4 text-sm text-danger">
          Could not load documents: {docsError}
          {migrationHint ? (
            <>
              {" "}
              Paste{" "}
              <code className="rounded-md border border-red-200 bg-white px-1.5 py-0.5 text-xs text-foreground">
                supabase/migrations/005_documents.sql
              </code>{" "}
              into the Supabase SQL Editor (creates table + Storage bucket
              policies), then refresh.
            </>
          ) : null}
        </p>
      ) : null}
      <DocumentsPanel
        householdId={household.id}
        householdName={household.name}
        userId={user.id}
        initialDocuments={documents}
      />
    </div>
  );
}
