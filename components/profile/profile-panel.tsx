"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getAvatarSignedUrl,
  HOUSEHOLD_ROLES,
  HOUSEHOLD_ROLE_LABELS,
  initialsFromProfile,
  removeAvatar,
  roleLabel,
  updateHouseholdName,
  updateOwnHouseholdRole,
  updateOwnProfile,
  uploadAvatar,
} from "@/lib/profile";
import type { HouseholdRole, Profile } from "@/lib/types";

const fieldClass =
  "w-full rounded-xl border border-border bg-background px-3.5 py-3 text-sm text-foreground shadow-[var(--shadow-sm)] placeholder:text-muted-foreground transition-colors hover:border-border-strong focus:border-accent focus:bg-card focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]";

const secondaryBtn =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50";

const primaryBtn =
  "inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-50";

type Props = {
  userId: string;
  email: string;
  householdId: string | null;
  householdName: string | null;
  householdRole: HouseholdRole | null;
  initialProfile: Profile;
  initialAvatarUrl: string | null;
};

export function ProfilePanel({
  userId,
  email,
  householdId,
  householdName: initialHouseholdName,
  householdRole: initialHouseholdRole,
  initialProfile,
  initialAvatarUrl,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(
    initialProfile.display_name ?? ""
  );
  const [phone, setPhone] = useState(initialProfile.phone ?? "");
  const [teamName, setTeamName] = useState(initialHouseholdName ?? "");
  const [savedTeamName, setSavedTeamName] = useState(
    initialHouseholdName ?? ""
  );
  const [role, setRole] = useState<HouseholdRole | "">(
    initialHouseholdRole ?? ""
  );
  const [savedRole, setSavedRole] = useState<HouseholdRole | "">(
    initialHouseholdRole ?? ""
  );
  const [avatarPath, setAvatarPath] = useState(
    initialProfile.avatar_path ?? null
  );
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const initials = useMemo(
    () =>
      initialsFromProfile({
        display_name: displayName,
        email,
      }),
    [displayName, email]
  );

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const notes: string[] = [];
    let failed: string | null = null;

    const { profile, error: updateError } = await updateOwnProfile(
      supabase,
      userId,
      { display_name: displayName, phone: phone || null }
    );

    if (!profile) {
      setSaving(false);
      setError(updateError ?? "Could not save profile.");
      return;
    }

    setDisplayName(profile.display_name ?? "");
    setPhone(profile.phone ?? "");
    setAvatarPath(profile.avatar_path ?? null);
    if (updateError) {
      notes.push(updateError);
    } else {
      notes.push("Profile saved.");
    }

    if (householdId) {
      if (teamName.trim() && teamName.trim() !== savedTeamName.trim()) {
        const { name, error: nameError } = await updateHouseholdName(
          supabase,
          householdId,
          teamName
        );
        if (nameError || !name) {
          failed = nameError ?? "Could not update parenting team name.";
        } else {
          setTeamName(name);
          setSavedTeamName(name);
          notes.push("Parenting team name updated.");
        }
      }

      if (role && role !== savedRole) {
        const { role: nextRole, error: roleError } = await updateOwnHouseholdRole(
          supabase,
          userId,
          householdId,
          role
        );
        if (roleError || !nextRole) {
          failed = roleError ?? "Could not update role.";
        } else {
          setRole(nextRole);
          setSavedRole(nextRole);
          notes.push(`Role set to ${roleLabel(nextRole)}.`);
        }
      }
    }

    setSaving(false);
    if (failed) {
      setError(failed);
      setMessage(notes.join(" "));
    } else {
      setMessage(
        notes.join(" ") ||
          "Profile saved. Your display name will show in messages and calendar labels."
      );
    }
    router.refresh();
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { path, error: uploadError } = await uploadAvatar(
      supabase,
      userId,
      file,
      avatarPath
    );

    if (uploadError || !path) {
      setUploading(false);
      setError(uploadError ?? "Could not upload photo.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const url = await getAvatarSignedUrl(supabase, path);
    setAvatarPath(path);
    setAvatarUrl(url);
    setUploading(false);
    setMessage("Photo updated.");
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function onRemovePhoto() {
    if (!avatarPath && !avatarUrl) return;
    setUploading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error: removeError } = await removeAvatar(
      supabase,
      userId,
      avatarPath
    );
    setUploading(false);

    if (removeError) {
      setError(removeError);
      return;
    }

    setAvatarPath(null);
    setAvatarUrl(null);
    setMessage("Photo removed.");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
          Account
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Profile
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-muted">
          Update how you appear to your parenting team. Email stays tied to your
          sign-in account.
        </p>
      </div>

      <form
        onSubmit={onSave}
        className="space-y-6 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-accent-soft text-xl font-bold text-accent ring-1 ring-border">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span aria-hidden>{initials}</span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-semibold text-foreground">Photo</p>
            <p className="text-sm text-muted">
              JPEG, PNG, WebP, or GIF up to 2 MB. Optional.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={secondaryBtn}
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? "Uploading..." : avatarUrl ? "Change photo" : "Upload photo"}
              </button>
              {avatarUrl || avatarPath ? (
                <button
                  type="button"
                  className={secondaryBtn}
                  disabled={uploading}
                  onClick={onRemovePhoto}
                >
                  Remove
                </button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => void onPickPhoto(e.target.files?.[0])}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block space-y-2 sm:col-span-2">
            <span className="text-sm font-semibold text-foreground">
              Display name
            </span>
            <input
              className={fieldClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              required
              autoComplete="name"
              placeholder="How your parenting team sees you"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-foreground">Email</span>
            <input
              className={`${fieldClass} cursor-not-allowed bg-surface text-muted`}
              value={email}
              readOnly
              tabIndex={-1}
              aria-readonly="true"
            />
            <span className="block text-xs text-muted">
              Sign-in email cannot be changed here.
            </span>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-foreground">Phone</span>
            <input
              className={fieldClass}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={40}
              autoComplete="tel"
              placeholder="Optional"
              inputMode="tel"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-foreground">
              Parenting team name
            </span>
            {householdId ? (
              <input
                className={fieldClass}
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                maxLength={120}
                required
                placeholder="Our parenting team"
              />
            ) : (
              <input
                className={`${fieldClass} cursor-not-allowed bg-surface text-muted`}
                value="No parenting team yet"
                readOnly
                tabIndex={-1}
                aria-readonly="true"
              />
            )}
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-foreground">Role</span>
            {householdId ? (
              <select
                className={fieldClass}
                value={role}
                onChange={(e) => setRole(e.target.value as HouseholdRole)}
                required
              >
                <option value="" disabled>
                  Select a role
                </option>
                {HOUSEHOLD_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {HOUSEHOLD_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={`${fieldClass} cursor-not-allowed bg-surface text-muted`}
                value={roleLabel(null)}
                readOnly
                tabIndex={-1}
                aria-readonly="true"
              />
            )}
          </label>
        </div>

        {error ? (
          <p className="rounded-xl border border-red-200 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-xl border border-border bg-accent-soft px-3.5 py-2.5 text-sm text-accent">
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryBtn} disabled={saving || uploading}>
            {saving ? "Saving..." : "Save profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
