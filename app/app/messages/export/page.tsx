import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/messages/print-button";
import { ensureHousehold, listMessages } from "@/lib/households";
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
        <p className="text-sm text-red-700">
          Could not load household
          {householdError ? `: ${householdError}` : "."}
        </p>
        <Link href="/app/messages" className="text-sm text-accent underline">
          Back to messages
        </Link>
      </div>
    );
  }

  const { messages, error: messagesError } = await listMessages(
    supabase,
    household.id
  );
  const exportedAt = new Date().toISOString();

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Transcript export
          </h1>
          <p className="mt-1 text-sm text-muted">
            Print this page or save as PDF from your browser.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/messages"
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium"
          >
            Back to messages
          </Link>
          <PrintButton />
        </div>
      </div>

      <article className="relative overflow-hidden rounded-xl border border-border bg-card p-6 shadow-sm print:border-0 print:shadow-none">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.07] print:opacity-[0.12]"
        >
          <p className="rotate-[-24deg] select-none text-4xl font-bold tracking-wide text-foreground sm:text-5xl">
            Ex Communicator export
          </p>
        </div>

        <header className="relative space-y-1 border-b border-border pb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Ex Communicator export
          </p>
          <h2 className="text-xl font-semibold">{household.name}</h2>
          <p className="text-sm text-muted">
            Exported: {formatTime(exportedAt)} ({exportedAt})
          </p>
          <p className="text-sm text-muted">{messages.length} message(s)</p>
        </header>

        {messagesError ? (
          <p className="relative mt-4 text-sm text-red-700">{messagesError}</p>
        ) : null}

        <ol className="relative mt-4 space-y-4">
          {messages.length === 0 ? (
            <li className="text-sm text-muted">No messages in this household.</li>
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
                    <span className="font-medium text-foreground">{who}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                    {message.body}
                  </p>
                </li>
              );
            })
          )}
        </ol>

        <footer className="relative mt-8 border-t border-border pt-4 text-center text-xs text-muted">
          Ex Communicator export · {household.name} · {exportedAt}
        </footer>
      </article>
    </div>
  );
}
