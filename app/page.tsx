import Link from "next/link";

const features = [
  {
    title: "Messaging",
    body: "Keep co-parent conversations in one place with transcripts you can export.",
  },
  {
    title: "Calendar",
    body: "Share custody schedules, school events, and handoffs without the back-and-forth.",
  },
  {
    title: "Documents",
    body: "Store orders, forms, and receipts in a shared vault both parents can access.",
  },
  {
    title: "Expenses",
    body: "Track shared costs and keep a clear record of who paid what.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link
            href="/"
            className="text-[15px] font-semibold tracking-tight text-foreground"
          >
            Ex Communicator
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/app"
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover"
            >
              Open app
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-14 sm:px-6 sm:py-20">
        <section className="max-w-2xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-accent">
            Co-parenting, clarified
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Ex Communicator
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-8 text-muted">
            An AI co-parenting app for calmer messaging, shared calendars, and
            records you can take to court.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover"
            >
              Get started
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="mt-16 grid gap-4 sm:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]"
            >
              <h2 className="text-base font-semibold text-foreground">
                {feature.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">{feature.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 text-sm text-muted sm:px-6">
          <span>Ex Communicator</span>
          <a
            href="https://github.com/wolfwell2025/ex-communicator-app"
            className="transition-colors hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
