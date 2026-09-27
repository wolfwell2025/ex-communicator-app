import type { SupabaseClient } from "@supabase/supabase-js";
import type { HouseholdRole, Profile } from "./types";

export const AVATARS_BUCKET = "avatars";
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MiB

const ALLOWED_AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const PROFILE_COLS =
  "id, email, display_name, phone, avatar_path, created_at";

export type ProfileUpdateInput = {
  display_name: string;
  phone: string | null;
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "avatar";
}

function buildAvatarPath(userId: string, fileName: string): string {
  const safe = sanitizeFileName(fileName);
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
  return `${userId}/${id}-${safe}`;
}

export function initialsFromProfile(profile: {
  display_name?: string | null;
  email?: string | null;
}): string {
  const name = profile.display_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  const email = profile.email?.trim();
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

export async function getOwnProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<{ profile: Profile | null; error: string | null }> {
  const { data: ensured, error: ensureError } = await supabase.rpc(
    "ensure_profile"
  );
  if (ensureError) {
    return { profile: null, error: ensureError.message };
  }

  // ensure_profile may return a row without new columns if migration not run;
  // always re-select so we get phone / avatar_path when present.
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    const missingCol = /phone|avatar_path|schema cache|Could not find|column/i.test(
      error.message
    );
    if (missingCol) {
      const { data: base } = await supabase
        .from("profiles")
        .select("id, email, display_name, created_at")
        .eq("id", userId)
        .maybeSingle();
      if (base) {
        return {
          profile: {
            ...(base as Omit<Profile, "phone" | "avatar_path">),
            phone: null,
            avatar_path: null,
          },
          error:
            "Profile phone/photo need migration 009_profile_fields.sql in the Supabase SQL Editor.",
        };
      }
    }
    const fallback = (
      Array.isArray(ensured) ? ensured[0] : ensured
    ) as Profile | null;
    if (fallback) {
      return {
        profile: {
          id: fallback.id,
          email: fallback.email ?? null,
          display_name: fallback.display_name ?? null,
          phone: fallback.phone ?? null,
          avatar_path: fallback.avatar_path ?? null,
          created_at: fallback.created_at,
        },
        error: null,
      };
    }
    return { profile: null, error: error.message };
  }

  if (!data) {
    return { profile: null, error: "Profile not found." };
  }

  return { profile: data as Profile, error: null };
}

export async function getOwnHouseholdRole(
  supabase: SupabaseClient,
  userId: string,
  householdId: string
): Promise<{ role: HouseholdRole | null; error: string | null }> {
  const { data, error } = await supabase
    .from("household_members")
    .select("role")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { role: null, error: error.message };
  }
  return {
    role: (data?.role as HouseholdRole | undefined) ?? null,
    error: null,
  };
}

export async function updateOwnProfile(
  supabase: SupabaseClient,
  userId: string,
  input: ProfileUpdateInput
): Promise<{ profile: Profile | null; error: string | null }> {
  const displayName = input.display_name.trim();
  if (!displayName) {
    return { profile: null, error: "Display name is required." };
  }
  if (displayName.length > 80) {
    return { profile: null, error: "Display name must be 80 characters or fewer." };
  }

  const phoneRaw = input.phone?.trim() || null;
  if (phoneRaw && phoneRaw.length > 40) {
    return { profile: null, error: "Phone must be 40 characters or fewer." };
  }

  const fullUpdate = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      phone: phoneRaw,
    })
    .eq("id", userId)
    .select(PROFILE_COLS)
    .single();

  if (!fullUpdate.error && fullUpdate.data) {
    return { profile: fullUpdate.data as Profile, error: null };
  }

  const errMsg = fullUpdate.error?.message ?? "";
  const missingCol = /phone|avatar_path|schema cache|Could not find/i.test(
    errMsg
  );

  if (missingCol) {
    // Migration not applied yet: still allow display_name (base column).
    const baseUpdate = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", userId)
      .select("id, email, display_name, created_at")
      .single();

    if (baseUpdate.error || !baseUpdate.data) {
      return {
        profile: null,
        error:
          baseUpdate.error?.message ??
          "Profile fields need the SQL migration. Paste supabase/migrations/009_profile_fields.sql into the Supabase SQL Editor, then try again.",
      };
    }

    return {
      profile: {
        ...(baseUpdate.data as Omit<Profile, "phone" | "avatar_path">),
        phone: null,
        avatar_path: null,
      },
      error: phoneRaw
        ? "Display name saved. Phone needs migration 009_profile_fields.sql in the Supabase SQL Editor."
        : null,
    };
  }

  return { profile: null, error: errMsg || "Could not save profile." };
}

export async function uploadAvatar(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  previousPath: string | null
): Promise<{ path: string | null; error: string | null }> {
  if (!file || file.size <= 0) {
    return { path: null, error: "Choose a photo to upload." };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { path: null, error: "Photo is too large (max 2 MB)." };
  }
  const mime = file.type || "";
  if (!ALLOWED_AVATAR_TYPES.has(mime)) {
    return {
      path: null,
      error: "Use a JPEG, PNG, WebP, or GIF image.",
    };
  }

  const filePath = buildAvatarPath(userId, file.name || "avatar.jpg");

  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(filePath, file, {
      contentType: mime,
      upsert: false,
    });

  if (uploadError) {
    const missingBucket = /bucket|not found|row-level security/i.test(
      uploadError.message
    );
    return {
      path: null,
      error: missingBucket
        ? `${uploadError.message} Paste supabase/migrations/009_profile_fields.sql into the Supabase SQL Editor if the avatars bucket is missing.`
        : uploadError.message,
    };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_path: filePath })
    .eq("id", userId);

  if (updateError) {
    await supabase.storage.from(AVATARS_BUCKET).remove([filePath]);
    return { path: null, error: updateError.message };
  }

  if (previousPath && previousPath !== filePath) {
    await supabase.storage.from(AVATARS_BUCKET).remove([previousPath]);
  }

  return { path: filePath, error: null };
}

export async function removeAvatar(
  supabase: SupabaseClient,
  userId: string,
  currentPath: string | null
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", userId);

  if (error) {
    return { error: error.message };
  }

  if (currentPath) {
    await supabase.storage.from(AVATARS_BUCKET).remove([currentPath]);
  }
  return { error: null };
}

export async function getAvatarSignedUrl(
  supabase: SupabaseClient,
  avatarPath: string | null | undefined,
  expiresIn = 3600
): Promise<string | null> {
  if (!avatarPath) return null;
  const { data, error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .createSignedUrl(avatarPath, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
