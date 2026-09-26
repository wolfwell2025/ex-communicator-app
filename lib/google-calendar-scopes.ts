/** Full calendar scope so we can push events when export_enabled is on. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

/** True if granted scopes include write access (not readonly-only). */
export function connectionHasWriteScope(
  scopes: string | null | undefined
): boolean {
  if (!scopes) return false;
  const parts = scopes.split(/\s+/).filter(Boolean);
  return parts.some(
    (p) =>
      p === "https://www.googleapis.com/auth/calendar" ||
      p === "https://www.googleapis.com/auth/calendar.events"
  );
}
