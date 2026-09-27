import {
  decodePendingOutlookAuth,
  encodePendingOutlookAuth,
  type PendingOutlookAuth,
} from "./outlook-calendar";

export const OUTLOOK_PENDING_COOKIE = "ocal_pending_auth";
export const OUTLOOK_PENDING_MAX_AGE = 900; // 15 minutes

export function serializeOutlookPendingCookie(
  pending: PendingOutlookAuth
): string {
  return encodePendingOutlookAuth(pending);
}

export function parseOutlookPendingCookie(
  value: string | undefined
): PendingOutlookAuth | null {
  if (!value) return null;
  try {
    const pending = decodePendingOutlookAuth(value);
    if (!pending.accessToken || !pending.expiresAt) return null;
    if (pending.expiresAt < Date.now() - 60_000) return null;
    return pending;
  } catch {
    return null;
  }
}
