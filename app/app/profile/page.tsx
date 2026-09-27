import { redirect } from "next/navigation";
import { ProfilePanel } from "@/components/profile/profile-panel";
import { ensureHousehold } from "@/lib/households";
import {
  getAvatarSignedUrl,
  getOwnHouseholdRole,
  getOwnProfile,
} from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/app/profile");
  }

  const [{ household }, { profile, error: profileError },] = await Promise.all([
    ensureHousehold(supabase),
    getOwnProfile(supabase, user.id),
  ]);

  const householdRole = household
    ? (await getOwnHouseholdRole(supabase, user.id, household.id)).role
    : null;

  const migrationHint =
    profileError &&
    /phone|avatar_path|009_profile|schema cache|Could not find|does not exist/i.test(
      profileError
    );

  const safeProfile: Profile = profile ?? {
    id: user.id,
    email: user.email ?? null,
    display_name:
      (user.user_metadata?.display_name as string | undefined) ??
      (user.email ? user.email.split("@")[0] : null) ??
      null,
    phone: null,
    avatar_path: null,
    created_at: new Date().toISOString(),
  };

  const initialAvatarUrl = await getAvatarSignedUrl(
    supabase,
    safeProfile.avatar_path
  );

  return (
    <div className="space-y-4">
      {profileError ? (
        <p className="rounded-2xl border border-amber-200 bg-warning-soft p-4 text-sm text-amber-900">
          Could not load full profile: {profileError}
          {migrationHint ? (
            <>
              {" "}
              Paste{" "}
              <code className="rounded-md border border-amber-200 bg-white px-1.5 py-0.5 text-xs text-foreground">
                supabase/migrations/009_profile_fields.sql
              </code>{" "}
              into the Supabase SQL Editor, then refresh. Display name still
              works from the base profiles table.
            </>
          ) : null}
        </p>
      ) : null}
      <ProfilePanel
        userId={user.id}
        email={user.email ?? safeProfile.email ?? ""}
        householdName={household?.name ?? null}
        householdRole={householdRole}
        initialProfile={safeProfile}
        initialAvatarUrl={initialAvatarUrl}
      />
    </div>
  );
}
