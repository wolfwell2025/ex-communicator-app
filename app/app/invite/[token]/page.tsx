import { redirect } from "next/navigation";
import { AcceptInvitePanel } from "@/components/household/accept-invite-panel";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function AcceptInvitePage({ params }: Props) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw || "").trim();

  if (!token) {
    redirect("/app");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/app/invite/${token}`)}`);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <AcceptInvitePanel token={token} userEmail={user.email ?? null} />
    </div>
  );
}
