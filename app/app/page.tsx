import Link from "next/link";
import { redirect } from "next/navigation";
import { InviteCoParent } from "@/components/household/invite-co-parent";
import { ensureHousehold } from "@/lib/households";
import { createClient } from "@/lib/supabase/server";

const modules = [
  {
    href: "/app/messages",
    title: "Messages",
    body: "Threaded co-parent messaging with exportable transcripts.",
    live: true,
    icon: "💬",
  },
  {
    href: "/app/calendar",
    title: "Calendar",
    body: "Shared parenting schedule with private events and propose/accept sharing.",
    live: true,
    icon: "📅",
  },
  {
    href: "/app/documents",
    title: "Documents",
    body: "Court orders, school forms, and shared file vault.",
    live: true,
    icon: "📁",
  },
  {
    href: "/app/expenses",
    title: "Expenses",
    body: "Kids costs, reimbursement requests, and paid history.",
    live: true,
    icon: "💳",
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
    <div className="space-y-10">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
          Workspace
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-muted">
          You are signed in
          {household ? (
            <>
              {" "}
              to{" "}
              <span className="font-semibold text-foreground">{household.name}</span>
            </>
          ) : null}
          . Messages, Calendar, Documents, and Expenses are live.
        </p>
        {householdError ? (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-warning-soft p-4 text-sm text-amber-900">
            Household setup needs the SQL migration. Paste{" "}
            <code className="rounded-md border border-amber-200 bg-white px-1.5 py-0.5 text-xs">
              supabase/migrations/001_households_messages.sql
            </code>{" "}
            into the Supabase SQL Editor, then refresh. ({householdError})
          </p>
        ) : null}
      </div>

      {household ? (
        <InviteCoParent
          householdId={household.id}
          householdName={household.name}
        />
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        {modules.map((module) => (
          <Link
            key={module.href}
            href={module.href}
            className="group rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-sm)] transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-xl">
                {module.icon}
              </div>
              {module.live ? (
                <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
                  Live
                </span>
              ) : (
                <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted ring-1 ring-border">
                  Coming soon
                </span>
              )}
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground group-hover:text-accent">
              {module.title}
            </h2>
            <p className="mt-2 text-base leading-7 text-muted">{module.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
