import Link from "next/link";

const features = [
  {
    title: "Secure messaging",
    body: "Court-ready co-parent threads with permanent records and one-click transcripts.",
    icon: "💬",
  },
  {
    title: "Shared calendar",
    body: "Custody schedules, school events, and handoffs in one calm place.",
    icon: "📅",
  },
  {
    title: "Document vault",
    body: "Orders, forms, and receipts both parents can find in seconds.",
    icon: "📁",
  },
  {
    title: "Expense tracking",
    body: "Shared costs with a clear history of who paid what.",
    icon: "💳",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-sm font-bold tracking-tight text-white shadow-[var(--shadow-sm)]">
              EC
            </span>
            <span className="text-lg font-semibold tracking-tight text-foreground">
              Ex Communicator
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/app"
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover"
            >
              Open app
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-16 sm:px-6 sm:py-24">
        <section className="max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-accent shadow-[var(--shadow-sm)]">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            New clean workspace
          </div>
          <h1 className="text-5xl font-semibold tracking-tight text-foreground sm:text-6xl sm:leading-[1.05]">
            Co-parenting,{" "}
            <span className="text-accent">without the noise</span>
          </h1>
          <p className="mt-6 max-w-2xl text-xl leading-8 text-muted">
            A bright, court-ready messaging workspace for calmer conversations,
            shared schedules, and records you can export.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="rounded-xl bg-accent px-6 py-3.5 text-base font-semibold text-white shadow-[var(--shadow-md)] transition-colors hover:bg-accent-hover"
            >
              Get started free
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-border bg-card px-6 py-3.5 text-base font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="mt-20 grid gap-5 sm:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-7"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-xl">
                {feature.icon}
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {feature.title}
              </h2>
              <p className="mt-2 text-base leading-7 text-muted">{feature.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 text-sm text-muted sm:px-6">
          <span className="font-medium text-foreground">Ex Communicator</span>
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
