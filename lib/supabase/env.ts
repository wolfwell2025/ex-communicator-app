/**
 * Shared env resolution for Supabase clients and public site URL.
 * Prefer the new publishable key; fall back to ANON for older SDK/docs expectations.
 */

/**
 * Canonical public site origin for auth email redirects.
 * Prefer NEXT_PUBLIC_SITE_URL so confirmation/magic links never default to
 * localhost in production. Falls back to window.location.origin in the browser,
 * then VERCEL_URL on the server, then localhost for local dev only.
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured) {
    return configured;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  const vercel = process.env.VERCEL_URL?.trim().replace(/\/$/, "");
  if (vercel) {
    return `https://${vercel}`;
  }

  return "http://localhost:3000";
}

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  return url;
}

export function getSupabaseAnonKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }
  return key;
}
