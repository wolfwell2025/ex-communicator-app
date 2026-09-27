/** Full calendar write scope so we can push events when export_enabled is on. */
export const OUTLOOK_CALENDAR_SCOPES = [
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
].join(" ");

/** True if granted scopes include Calendars.ReadWrite (not Read-only). */
export function outlookConnectionHasWriteScope(
  scopes: string | null | undefined
): boolean {
  if (!scopes) return false;
  const parts = scopes.split(/\s+/).filter(Boolean);
  return parts.some(
    (p) =>
      p === "Calendars.ReadWrite" ||
      p === "https://graph.microsoft.com/Calendars.ReadWrite"
  );
}
