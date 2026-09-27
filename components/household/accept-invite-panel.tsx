"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  acceptHouseholdInvite,
  peekHouseholdInvite,
} from "@/lib/invites";
import type { HouseholdInvitePeek } from "@/lib/types";

type Props = {
  token: string;
  userEmail: string | null;
};

const primaryBtn =
  "inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

const secondaryBtn =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] hover:bg-surface";

export function AcceptInvitePanel({ token, userEmail }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [invite, setInvite] = useState<HouseholdInvitePeek | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { invite: peeked, error: err } = await peekHouseholdInvite(
        supabase,
        token
      );
      if (cancelled) return;
      if (err) {
        setLoadError(err);
        return;
      }
      if (!peeked) {
        setLoadError("Invite not found.");
        return;
      }
      setInvite(peeked);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, token]);

  const emailMatches =
    Boolean(userEmail) &&
    Boolean(invite?.email) &&
    userEmail!.trim().toLowerCase() === invite!.email.trim().toLowerCase();

  async function onAccept() {
    setBusy(true);
    setError(null);
    const { householdId, error: acceptErr } = await acceptHouseholdInvite(
      supabase,
      token
    );
    if (acceptErr || !householdId) {
      setError(acceptErr ?? "Could not accept invite.");
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
    router.refresh();
  }

  if (loadError) {
    return (
      <div className="rounded-3xl border border-red-200 bg-danger-soft p-6 text-sm text-danger">
        {loadError}
        <div className="mt-4">
          <Link href="/app" className={secondaryBtn}>
            Back to app
          </Link>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="rounded-3xl border border-border bg-card p-6 text-sm text-muted shadow-[var(--shadow-sm)]">
        Loading invite…
      </div>
    );
  }

  if (done || invite.status === "accepted") {
    return (
      <div className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          You joined {invite.household_name}
        </h1>
        <p className="text-sm leading-6 text-muted">
          You and your co-parent now share this parenting team. Open Calendar to test
          private events and propose/accept sharing.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/app/calendar" className={primaryBtn}>
            Open Calendar
          </Link>
          <Link href="/app/messages" className={secondaryBtn}>
            Open Messages
          </Link>
        </div>
      </div>
    );
  }

  if (invite.status !== "pending") {
    return (
      <div className="rounded-3xl border border-amber-200 bg-warning-soft p-6 text-sm text-amber-900">
        This invite is {invite.status}. Ask your co-parent to send a new one.
        <div className="mt-4">
          <Link href="/app" className={secondaryBtn}>
            Back to app
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-lg)]">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
        Parenting team invite
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Join {invite.household_name}
      </h1>
      <p className="text-base leading-7 text-muted">
        <span className="font-semibold text-foreground">
          {invite.invited_by_label}
        </span>{" "}
        invited <span className="font-semibold text-foreground">{invite.email}</span>{" "}
        to co-parent in Ex Communicator.
      </p>

      {!emailMatches ? (
        <div className="rounded-2xl border border-amber-200 bg-warning-soft px-4 py-3 text-sm text-amber-900">
          You are signed in as{" "}
          <span className="font-semibold">{userEmail ?? "unknown"}</span>, but this
          invite is for <span className="font-semibold">{invite.email}</span>. Sign
          out and sign in (or create an account) with that email, then reopen
          this link.
          <div className="mt-3">
            <Link
              href={`/login?next=${encodeURIComponent(`/app/invite/${token}`)}`}
              className={primaryBtn}
            >
              Switch account
            </Link>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Signed in as <span className="font-semibold text-foreground">{userEmail}</span>.
          Accept to join the parenting team.
        </p>
      )}

      {error ? (
        <p className="rounded-xl border border-red-200 bg-danger-soft px-3.5 py-2.5 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || !emailMatches}
          onClick={() => void onAccept()}
        >
          {busy ? "Joining…" : "Accept invite"}
        </button>
        <Link href="/app" className={secondaryBtn}>
          Cancel
        </Link>
      </div>
    </div>
  );
}
