export default function ExpensesPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Expenses
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Shared expense tracking will land here.
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center shadow-[var(--shadow-sm)]">
        <p className="text-sm font-medium text-foreground">Coming soon</p>
        <p className="mt-1 text-sm text-muted">
          Placeholder module. No live data yet.
        </p>
      </div>
    </div>
  );
}
