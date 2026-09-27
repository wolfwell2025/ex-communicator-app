/** Gmail read-only intake (no send in this MVP). */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

/** Outlook / Microsoft Graph mail read (no send in this MVP). */
export const OUTLOOK_MAIL_SCOPES = [
  "offline_access",
  "User.Read",
  "Mail.Read",
].join(" ");

export function connectionHasGmailScope(
  scopes: string | null | undefined
): boolean {
  if (!scopes) return false;
  const parts = scopes.split(/\s+/).filter(Boolean);
  return parts.some(
    (p) =>
      p === "https://www.googleapis.com/auth/gmail.readonly" ||
      p === "https://www.googleapis.com/auth/gmail.modify" ||
      p === "https://mail.google.com/"
  );
}

export function connectionHasOutlookMailScope(
  scopes: string | null | undefined
): boolean {
  if (!scopes) return false;
  const parts = scopes.split(/\s+/).filter(Boolean);
  return parts.some(
    (p) =>
      p === "Mail.Read" ||
      p === "Mail.ReadWrite" ||
      p === "https://graph.microsoft.com/Mail.Read" ||
      p === "https://graph.microsoft.com/Mail.ReadWrite"
  );
}
