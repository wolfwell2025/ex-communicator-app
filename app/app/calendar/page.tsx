import { redirect } from "next/navigation";
import { CalendarPanel } from "@/components/calendar/calendar-panel";
import { InviteCoParent } from "@/components/household/invite-co-parent";
import {
  listCalendarEvents,
  listPersonalCalendarConnections,
} from "@/lib/calendar";
import { ensureHousehold } from "@/lib/households";
import { createClient } from "@/lib/supabase/server";

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/app/calendar");
  }

  const { household, error: householdError } = await ensureHousehold(supabase);

  if (householdError || !household) {
    return (
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Calendar
        </h1>
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-5 text-sm text-danger">
          Could not load or create your household
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

  const [{ events, error: eventsError }, { connections }] = await Promise.all([
    listCalendarEvents(supabase, household.id),
    listPersonalCalendarConnections(supabase, user.id),
  ]);

  const migrationHint =
    eventsError &&
    /calendar_events|does not exist|schema cache|Could not find/i.test(
      eventsError
    );

  return (
    <div className="space-y-4">
      {eventsError ? (
        <p className="rounded-2xl border border-red-200 bg-danger-soft p-4 text-sm text-danger">
          Could not load calendar events: {eventsError}
          {migrationHint ? (
            <>
              {" "}
              Paste{" "}
              <code className="rounded-md border border-red-200 bg-white px-1.5 py-0.5 text-xs text-foreground">
                supabase/migrations/002_calendar_events.sql
              </code>{" "}
              into the Supabase SQL Editor, then refresh.
            </>
          ) : null}
        </p>
      ) : null}
      <InviteCoParent
        householdId={household.id}
        householdName={household.name}
      />
      <CalendarPanel
        householdId={household.id}
        householdName={household.name}
        userId={user.id}
        initialEvents={events}
        initialConnections={connections}
      />
    </div>
  );
}
