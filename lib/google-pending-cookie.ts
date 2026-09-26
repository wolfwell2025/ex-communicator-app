import { decodePendingAuth, encodePendingAuth, type PendingGoogleAuth } from "./google-calendar";

export const PENDING_COOKIE = "gcal_pending_auth";
export const PENDING_MAX_AGE = 900; // 15 minutes

export function serializePendingCookie(pending: PendingGoogleAuth): string {
  return encodePendingAuth(pending);
}

export function parsePendingCookie(
  value: string | undefined
): PendingGoogleAuth | null {
  if (!value) return null;
  try {
    const pending = decodePendingAuth(value);
    if (!pending.accessToken || !pending.expiresAt) return null;
    if (pending.expiresAt < Date.now() - 60_000) return null;
    return pending;
  } catch {
    return null;
  }
}
