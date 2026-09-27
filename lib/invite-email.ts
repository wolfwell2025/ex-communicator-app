/**
 * Parenting-team invite email via Resend HTTP API.
 * Server-only: never import from client components.
 */

export type InviteEmailPayload = {
  to: string;
  inviterDisplayName: string;
  parentingTeamName: string;
  acceptUrl: string;
  expiresAt: string | null;
};

export type SendInviteEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const DEFAULT_FROM = "Ex Communicator <onboarding@resend.dev>";

export function getResendFromAddress(): string {
  const configured = process.env.RESEND_FROM_EMAIL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_FROM;
}

export function buildInviteEmailContent(payload: InviteEmailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const inviter = payload.inviterDisplayName.trim() || "A co-parent";
  const team = payload.parentingTeamName.trim() || "your parenting team";
  const expiryLine = payload.expiresAt
    ? formatExpiry(payload.expiresAt)
    : null;

  const subject = `${inviter} invited you to join ${team} on Ex Communicator`;

  const textLines = [
    `${inviter} invited you to join the parenting team "${team}" on Ex Communicator.`,
    "",
    "To accept:",
    "1. Sign up or log in with this same email address (the one this invite was sent to).",
    "2. Open the accept link below.",
    "3. Tap Accept to join the parenting team.",
    "",
    `Accept link: ${payload.acceptUrl}`,
  ];
  if (expiryLine) {
    textLines.push("", `This invite expires on ${expiryLine}.`);
  }
  textLines.push(
    "",
    "If you were not expecting this invite, you can ignore this email.",
    "",
    "Ex Communicator"
  );

  const expiryHtml = expiryLine
    ? `<p style="margin:16px 0 0;color:#64748b;font-size:14px;">This invite expires on <strong>${escapeHtml(expiryLine)}</strong>.</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;">
          <tr>
            <td>
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;">Ex Communicator</p>
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">You are invited to a parenting team</h1>
              <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#334155;">
                <strong>${escapeHtml(inviter)}</strong> invited you to join
                <strong>${escapeHtml(team)}</strong>.
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#334155;">
                Sign up or log in with <strong>this same email</strong>, then open the link and tap Accept.
              </p>
              <p style="margin:0 0 8px;">
                <a href="${escapeHtml(payload.acceptUrl)}"
                   style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px;">
                  Accept invite
                </a>
              </p>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#64748b;word-break:break-all;">
                Or paste this link into your browser:<br />
                <a href="${escapeHtml(payload.acceptUrl)}" style="color:#2563eb;">${escapeHtml(payload.acceptUrl)}</a>
              </p>
              ${expiryHtml}
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#94a3b8;">
                If you were not expecting this invite, you can ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text: textLines.join("\n"), html };
}

function formatExpiry(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    dateStyle: "medium",
    timeZone: "America/New_York",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send invite email via Resend REST API.
 * Only call with `to` equal to the invite row email.
 */
export async function sendInviteEmail(
  payload: InviteEmailPayload,
  options?: { idempotencyKey?: string }
): Promise<SendInviteEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Invite email is not configured (missing RESEND_API_KEY). Use Copy link to send the invite manually.",
    };
  }

  const to = payload.to.trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return { ok: false, error: "Invite email address is invalid." };
  }

  const { subject, text, html } = buildInviteEmailContent(payload);
  const from = getResendFromAddress();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (options?.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey.slice(0, 256);
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { ok: false, error: `Could not reach Resend: ${msg}` };
  }

  let body: { id?: string; message?: string; name?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // non-JSON error body
  }

  if (!response.ok) {
    const detail =
      body.message ||
      body.name ||
      `Resend returned HTTP ${response.status}`;
    return { ok: false, error: detail };
  }

  return { ok: true, id: body.id ?? "sent" };
}
