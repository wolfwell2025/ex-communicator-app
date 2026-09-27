import { redirect } from "next/navigation";
import { ExpensesPanel } from "@/components/expenses/expenses-panel";
import { listExpenses } from "@/lib/expenses";
import { ensureHousehold } from "@/lib/households";
import { listHouseholdMembers } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function ExpensesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/app/expenses");
  }

  const { household, error: householdError } = await ensureHousehold(supabase);

  if (householdError || !household) {
    return (
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Expenses
        </h1>
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-5 text-sm text-danger">
          Could not load or create your parenting team
          {householdError ? `: ${householdError}` : "."} If this is the first
          run, paste{" "}
          <code className="rounded-md border border-red-200 bg-white px-1.5 py-0.5 text-xs text-foreground">
            supabase/migrations/001_households_messages.sql
          </code>{" "}
          into the Supabase SQL Editor and try again.
        </p>
      </div>
    );
  }

  const [{ expenses, error: expensesError }, { members }] = await Promise.all([
    listExpenses(supabase, household.id),
    listHouseholdMembers(supabase, household.id),
  ]);

  const migrationHint =
    expensesError &&
    /expenses|does not exist|schema cache|Could not find/i.test(expensesError);

  return (
    <div className="space-y-4">
      {expensesError ? (
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-4 text-sm text-danger">
          Could not load expenses: {expensesError}
          {migrationHint ? (
            <>
              {" "}
              Paste{" "}
              <code className="rounded-md border border-red-200 bg-white px-1.5 py-0.5 text-xs text-foreground">
                supabase/migrations/008_expenses.sql
              </code>{" "}
              into the Supabase SQL Editor, then refresh.
            </>
          ) : null}
        </p>
      ) : null}
      <ExpensesPanel
        householdId={household.id}
        householdName={household.name}
        userId={user.id}
        memberCount={members.length || 1}
        initialExpenses={expenses}
      />
    </div>
  );
}
