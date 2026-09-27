import { redirect } from "next/navigation";
import { EmailPanel } from "@/components/email/email-panel";
import { listEmailConnections, listEmailThreads } from "@/lib/email";
import { gmailOAuthConfigured } from "@/lib/gmail";
import { outlookMailOAuthConfigured } from "@/lib/outlook-mail";
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

export default async function EmailPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/app/email");
  }

  const [
    { connections, error: connError, needsMigration: needsMigConn },
    { threads, error: threadError, needsMigration: needsMigThread },
  ] = await Promise.all([
    listEmailConnections(supabase, user.id),
    listEmailThreads(supabase, user.id),
  ]);

  const needsMigration = needsMigConn || needsMigThread;
  const loadError =
    !needsMigration && (connError || threadError)
      ? connError || threadError
      : null;

  return (
    <div className="space-y-4">
      {loadError ? (
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-4 text-sm text-danger">
          Could not load email: {loadError}
        </p>
      ) : null}
      <EmailPanel
        userId={user.id}
        initialConnections={connections}
        initialThreads={threads}
        needsMigration={needsMigration}
        gmailConfigured={gmailOAuthConfigured()}
        outlookConfigured={outlookMailOAuthConfigured()}
        flash={{
          gmailConnected:
            one(params.gmail_connected) === "1" ||
            one(params.gmail_connected) === "true",
          outlookConnected:
            one(params.outlook_connected) === "1" ||
            one(params.outlook_connected) === "true",
          gmailError: one(params.gmail_error) ?? null,
          outlookError: one(params.outlook_error) ?? null,
        }}
      />
    </div>
  );
}
