export default function ExpensesPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
          Module
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Expenses
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-muted">
          Shared expense tracking and payment history will land here.
        </p>
      </div>
      <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-[var(--shadow-sm)]">
        <p className="text-lg font-semibold text-foreground">Coming soon</p>
        <p className="mt-2 text-base text-muted">
          Placeholder module. No live data yet.
        </p>
      </div>
    </div>
  );
}
