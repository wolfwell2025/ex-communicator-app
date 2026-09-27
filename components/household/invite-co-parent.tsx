"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/supabase/env";
import {
  createHouseholdInvite,
  inviteAcceptUrl,
  listPendingInvites,
  revokeHouseholdInvite,
} from "@/lib/invites";
import type { HouseholdInvite } from "@/lib/types";

type Props = {
  householdId: string;
  householdName: string;
};

const secondaryBtn =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50";

const primaryBtn =
  "inline-flex items-center justify-center rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

async function requestInviteEmail(inviteId: string): Promise<{
  emailed: boolean;
  error: string | null;
  acceptUrl: string | null;
}> {
  try {
    const res = await fetch("/api/invites/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      emailed?: boolean;
      error?: string;
      acceptUrl?: string;
    };
    if (!res.ok || !data.emailed) {
      return {
        emailed: false,
        error:
          data.error ??
          `Could not send invite email (HTTP ${res.status}). Use Copy link to send it manually.`,
        acceptUrl: data.acceptUrl ?? null,
      };
    }
    return {
      emailed: true,
      error: null,
      acceptUrl: data.acceptUrl ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return {
      emailed: false,
      error: `Could not send invite email: ${msg}. Use Copy link to send it manually.`,
      acceptUrl: null,
    };
  }
}

export function InviteCoParent({ householdId, householdName }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [invites, setInvites] = useState<HouseholdInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { invites: next, error: err } = await listPendingInvites(
      supabase,
      householdId
    );
    if (err) {
      setLoadError(err);
      setInvites([]);
      return;
    }
    setLoadError(null);
    setInvites(next);
  }, [householdId, supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    const { invite, error: createErr } = await createHouseholdInvite(
      supabase,
      householdId,
      email
    );

    if (createErr || !invite) {
      setError(createErr ?? "Could not create invite.");
      setBusy(false);
      return;
    }

    setEmail("");

    const send = await requestInviteEmail(invite.id);
    if (send.emailed) {
      setMessage(
        `Invite emailed to ${invite.email}. They must sign up or log in with that same email, then open the link to join ${householdName}. Copy link remains available below if they need it again.`
      );
    } else {
      setError(send.error);
      setMessage(
        `Invite created for ${invite.email}, but the email could not be sent. Use Copy link below and send it yourself. They must sign up or log in with that same email, then open the link to join ${householdName}.`
      );
    }

    setBusy(false);
    await refresh();
  }

  async function onCopy(invite: HouseholdInvite) {
    const url = inviteAcceptUrl(invite.token, getSiteUrl());
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId((id) => (id === invite.id ? null : id)), 2000);
    } catch {
      setError(`Copy failed. Link: ${url}`);
    }
  }

  async function onEmailAgain(invite: HouseholdInvite) {
    if (busy || emailingId) return;
    setEmailingId(invite.id);
    setError(null);
    setMessage(null);
    const send = await requestInviteEmail(invite.id);
    if (send.emailed) {
      setMessage(`Invite email sent again to ${invite.email}.`);
    } else {
      setError(send.error);
      setMessage(
        `Email failed for ${invite.email}. Use Copy link to send the invite manually.`
      );
    }
    setEmailingId(null);
  }

  async function onRevoke(inviteId: string) {
    setBusy(true);
    setError(null);
    const { error: revErr } = await revokeHouseholdInvite(supabase, inviteId);
    if (revErr) setError(revErr);
    setBusy(false);
    await refresh();
  }

  const migrationHint =
    loadError &&
    /household_invites|does not exist|schema cache|Could not find|create_household_invite/i.test(
      loadError
    );

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Invite co-parent
        </h2>
        <p className="text-sm leading-6 text-muted">
          Enter their email to invite them to{" "}
          <span className="font-semibold text-foreground">{householdName}</span>.
          We email them an accept link. They sign up or log in with that email,
          open the link, and join your parenting team. Copy link stays available
          as a backup. Required for two-account calendar privacy testing.
        </p>
      </div>

      {migrationHint ? (
        <p className="mt-3 rounded-2xl border border-amber-200 bg-warning-soft px-3.5 py-2.5 text-sm text-amber-900">
          Run{" "}
          <code className="rounded-md border border-amber-200 bg-white px-1.5 py-0.5 text-xs">
            supabase/migrations/003_household_invites.sql
          </code>{" "}
          in the Supabase SQL Editor, then refresh. ({loadError})
        </p>
      ) : loadError ? (
        <p className="mt-3 rounded-2xl border border-red-200 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {loadError}
        </p>
      ) : null}

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <label className="block min-w-0 flex-1 space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Co-parent email
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="coparent@example.com"
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
          />
        </label>
        <button type="submit" className={primaryBtn} disabled={busy}>
          {busy ? "Sending…" : "Create invite"}
        </button>
      </form>

      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 text-sm leading-6 text-foreground" role="status">
          {message}
        </p>
      ) : null}

      {invites.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {invites.map((invite) => {
            const url = inviteAcceptUrl(invite.token, getSiteUrl());
            return (
              <li
                key={invite.id}
                className="rounded-2xl border border-border bg-background px-3.5 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {invite.email}
                    </p>
                    <p className="mt-0.5 break-all text-xs text-muted">{url}</p>
                    <p className="mt-1 text-[11px] text-muted">
                      Expires{" "}
                      {new Date(invite.expires_at).toLocaleDateString(undefined, {
                        dateStyle: "medium",
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={busy || emailingId === invite.id}
                      onClick={() => void onEmailAgain(invite)}
                    >
                      {emailingId === invite.id ? "Emailing…" : "Email invite"}
                    </button>
                    <button
                      type="button"
                      className={secondaryBtn}
                      onClick={() => void onCopy(invite)}
                    >
                      {copiedId === invite.id ? "Copied" : "Copy link"}
                    </button>
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={busy}
                      onClick={() => void onRevoke(invite.id)}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : !loadError ? (
        <p className="mt-4 text-sm text-muted">No pending invites yet.</p>
      ) : null}
    </section>
  );
}
