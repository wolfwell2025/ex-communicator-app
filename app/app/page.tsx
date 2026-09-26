import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureHousehold } from "@/lib/households";
import { createClient } from "@/lib/supabase/server";

const modules = [
  {
    href: "/app/messages",
    title: "Messages",
    body: "Threaded co-parent messaging with exportable transcripts.",
    live: true,
  },
  {
    href: "/app/calendar",
    title: "Calendar",
    body: "Shared parenting schedule and event reminders.",
    live: false,
  },
  {
    href: "/app/documents",
    title: "Documents",
    body: "Court orders, school forms, and shared file vault.",
    live: false,
  },
  {
    href: "/app/expenses",
    title: "Expenses",
    body: "Shared cost tracking and payment history.",
    live: false,
  },
];

export default async function AppHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/app");
  }

  const { household, error: householdError } = await ensureHousehold(supabase);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          You are signed in
          {household ? (
            <>
              {" "}
              to <span className="font-medium text-foreground">{household.name}</span>
            </>
          ) : null}
          . Messages is live; other modules are still stubs.
        </p>
        {householdError ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Household setup needs the SQL migration. Paste{" "}
            <code className="rounded bg-white px-1 py-0.5 text-xs">
              supabase/migrations/001_households_messages.sql
            </code>{" "}
            into the Supabase SQL Editor, then refresh. ({householdError})
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {modules.map((module) => (
          <Link
            key={module.href}
            href={module.href}
            className="rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-accent"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {module.title}
              </h2>
              {module.live ? (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                  Live
                </span>
              ) : (
                <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted">
                  Stub
                </span>
              )}
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">{module.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
