import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/messages/print-button";
import { ensureHousehold } from "@/lib/households";
import { listThreads, listThreadMessages, memberLabel } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default async function MessagesExportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/app/messages/export");
  }

  const { household, error: householdError } = await ensureHousehold(supabase);

  if (householdError || !household) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Export</h1>
        <p className="text-sm text-danger">
          Could not load parenting team
          {householdError ? `: ${householdError}` : "."}
        </p>
        <Link href="/app/messages" className="text-sm font-medium text-accent hover:text-accent-hover">
          Back to messages
        </Link>
      </div>
    );
  }

  const { threads, error: threadsError, needsMigration } = await listThreads(
    supabase,
    household.id
  );

  const threadsWithMessages = await Promise.all(
    threads.map(async (thread) => {
      const { messages } = await listThreadMessages(supabase, thread.id);
      return { thread, messages };
    })
  );

  const totalMessages = threadsWithMessages.reduce(
    (n, t) => n + t.messages.length,
    0
  );
  const exportedAt = new Date().toISOString();

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Transcript export
          </h1>
          <p className="text-sm text-muted">
            Print this page or save as PDF from your browser. Grouped by subject.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/messages"
            className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface"
          >
            Back to messages
          </Link>
          <PrintButton />
        </div>
      </div>

      {needsMigration ? (
        <p className="rounded-2xl border border-amber-200 bg-warning-soft p-4 text-sm text-warning print:hidden">
          Run{" "}
          <code className="rounded bg-white px-1.5 py-0.5 text-xs text-foreground">
            supabase/migrations/006_message_threads.sql
          </code>{" "}
          in the Supabase SQL Editor, then refresh for subject-grouped export.
        </p>
      ) : null}

      <article className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-md)] print:border-0 print:shadow-none sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.05] print:opacity-[0.1]"
        >
          <p className="rotate-[-24deg] select-none text-4xl font-bold tracking-wide text-foreground sm:text-5xl">
            Ex Communicator export
          </p>
        </div>

        <header className="relative space-y-1 border-b border-border pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            Ex Communicator export
          </p>
          <h2 className="text-xl font-semibold text-foreground">
            {household.name}
          </h2>
          <p className="text-sm text-muted">
            Exported: {formatTime(exportedAt)} ({exportedAt})
          </p>
          <p className="text-sm text-muted">
            {threads.length} thread(s) · {totalMessages} message(s)
          </p>
        </header>

        {threadsError && !needsMigration ? (
          <p className="relative mt-4 text-sm text-danger">{threadsError}</p>
        ) : null}

        <div className="relative mt-5 space-y-8">
          {threadsWithMessages.length === 0 ? (
            <p className="text-sm text-muted">No threads in this parenting team.</p>
          ) : (
            threadsWithMessages.map(({ thread, messages }, threadIndex) => {
              const toLabel = thread.participants
                .filter((p) => p.user_id !== user.id)
                .map(memberLabel)
                .join(", ");
              return (
                <section key={thread.id} className="space-y-3">
                  <div className="border-b border-border pb-2">
                    <h3 className="text-base font-semibold text-foreground">
                      {threadIndex + 1}. {thread.subject}
                    </h3>
                    <p className="text-xs text-muted">
                      To: {toLabel || "Parenting team"}
                      <span className="mx-1.5">·</span>
                      {messages.length} message(s)
                    </p>
                  </div>
                  <ol className="space-y-4">
                    {messages.length === 0 ? (
                      <li className="text-sm text-muted">No messages.</li>
                    ) : (
                      messages.map((message, index) => {
                        const who =
                          message.sender_email ??
                          message.sender_display_name ??
                          message.sender_id;
                        return (
                          <li
                            key={message.id}
                            className="border-b border-border/70 pb-4 last:border-0"
                          >
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
                              <span className="font-mono">#{index + 1}</span>
                              <time dateTime={message.created_at}>
                                {formatTime(message.created_at)}
                              </time>
                              <span className="font-medium text-foreground">
                                {who}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                              {message.body}
                            </p>
                          </li>
                        );
                      })
                    )}
                  </ol>
                </section>
              );
            })
          )}
        </div>

        <footer className="relative mt-8 border-t border-border pt-4 text-center text-xs text-muted">
          Ex Communicator export · {household.name} · {exportedAt}
        </footer>
      </article>
    </div>
  );
}
