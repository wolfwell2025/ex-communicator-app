import Link from "next/link";

const modules = [
  {
    href: "/app/messages",
    title: "Messages",
    body: "Threaded co-parent messaging with exportable transcripts.",
  },
  {
    href: "/app/calendar",
    title: "Calendar",
    body: "Shared parenting schedule and event reminders.",
  },
  {
    href: "/app/documents",
    title: "Documents",
    body: "Court orders, school forms, and shared file vault.",
  },
  {
    href: "/app/expenses",
    title: "Expenses",
    body: "Shared cost tracking and payment history.",
  },
];

export default function AppHomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Placeholder shell for the first product slice. Auth, Supabase, and
          live data come next. Use the nav stubs below to walk the intended
          structure.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {modules.map((module) => (
          <Link
            key={module.href}
            href={module.href}
            className="rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-accent"
          >
            <h2 className="text-base font-semibold text-foreground">
              {module.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">{module.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
