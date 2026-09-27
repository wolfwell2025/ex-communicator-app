import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "./crypto-tokens";
import { GMAIL_SCOPES, connectionHasGmailScope } from "./email-scopes";
import { getSiteUrl } from "./supabase/env";

/**
 * HARD PRIVACY RULE:
 * Gmail sync ALWAYS stores threads/messages as owner-private (RLS user_id).
 * Co-parent never sees imported email until the owner explicitly drafts into
 * parenting-team Messages. Never auto-share on connect/sync.
 */

export { GMAIL_SCOPES, connectionHasGmailScope } from "./email-scopes";

export type GoogleMailTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

type ConnectionSecrets = {
  id: string;
  user_id: string;
  sync_enabled: boolean;
  status: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  external_account_email: string | null;
};

export function gmailOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export function getGmailRedirectUri(): string {
  const override = process.env.GMAIL_REDIRECT_URI?.trim().replace(/\/$/, "");
  if (override) return override;
  return `${getSiteUrl()}/api/email/gmail/callback`;
}

export function buildGmailAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new Error("Missing GOOGLE_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGmailRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGmailCode(
  code: string
): Promise<GoogleMailTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getGmailRedirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as GoogleMailTokenResponse & {
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error || `Token exchange failed (${res.status})`);
  }
  return json;
}

export async function refreshGmailAccessToken(
  refreshToken: string
): Promise<GoogleMailTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as GoogleMailTokenResponse & {
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error || `Token refresh failed (${res.status})`);
  }
  return json;
}

export async function fetchGoogleUserEmail(
  accessToken: string
): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { email?: string };
  return json.email ?? null;
}

function mergeScopes(...parts: (string | null | undefined)[]): string {
  const set = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const s of part.split(/\s+/).filter(Boolean)) set.add(s);
  }
  return [...set].join(" ");
}

async function getValidAccessToken(
  supabase: SupabaseClient,
  connection: ConnectionSecrets
): Promise<string> {
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;
  if (
    connection.access_token_enc &&
    expiresAt > Date.now() + 60_000
  ) {
    return decryptSecret(connection.access_token_enc);
  }
  if (!connection.refresh_token_enc) {
    throw new Error("Missing refresh token; reconnect Gmail");
  }
  const refreshToken = decryptSecret(connection.refresh_token_enc);
  const refreshed = await refreshGmailAccessToken(refreshToken);
  const accessEnc = encryptSecret(refreshed.access_token);
  const expires = new Date(
    Date.now() + (refreshed.expires_in || 3600) * 1000
  ).toISOString();
  await supabase
    .from("email_connections")
    .update({
      access_token_enc: accessEnc,
      token_expires_at: expires,
      scopes: mergeScopes(refreshed.scope, connection.scopes, GMAIL_SCOPES),
      last_error: null,
    })
    .eq("id", connection.id)
    .eq("user_id", connection.user_id);
  return refreshed.access_token;
}

export async function upsertGmailConnection(args: {
  supabase: SupabaseClient;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string | null;
  email: string | null;
}): Promise<{ connectionId: string | null; error: string | null }> {
  const email = args.email?.trim() || null;
  const accessEnc = encryptSecret(args.accessToken);
  const refreshEnc = args.refreshToken
    ? encryptSecret(args.refreshToken)
    : null;
  const scopes = mergeScopes(args.scopes, GMAIL_SCOPES);
  const expiresIso = new Date(args.expiresAt).toISOString();

  const { data: existing } = await args.supabase
    .from("email_connections")
    .select("id, refresh_token_enc")
    .eq("user_id", args.userId)
    .eq("provider", "gmail")
    .eq("external_account_email", email ?? "")
    .maybeSingle();

  if (existing?.id) {
    const { error } = await args.supabase
      .from("email_connections")
      .update({
        status: "connected",
        sync_enabled: true,
        access_token_enc: accessEnc,
        refresh_token_enc: refreshEnc ?? existing.refresh_token_enc,
        token_expires_at: expiresIso,
        scopes,
        last_error: null,
      })
      .eq("id", existing.id)
      .eq("user_id", args.userId);
    if (error) return { connectionId: null, error: error.message };
    return { connectionId: existing.id, error: null };
  }

  // Also match rows with null email if we now have one
  if (email) {
    const { data: nullEmail } = await args.supabase
      .from("email_connections")
      .select("id, refresh_token_enc")
      .eq("user_id", args.userId)
      .eq("provider", "gmail")
      .is("external_account_email", null)
      .maybeSingle();
    if (nullEmail?.id) {
      const { error } = await args.supabase
        .from("email_connections")
        .update({
          status: "connected",
          sync_enabled: true,
          external_account_email: email,
          access_token_enc: accessEnc,
          refresh_token_enc: refreshEnc ?? nullEmail.refresh_token_enc,
          token_expires_at: expiresIso,
          scopes,
          last_error: null,
        })
        .eq("id", nullEmail.id)
        .eq("user_id", args.userId);
      if (error) return { connectionId: null, error: error.message };
      return { connectionId: nullEmail.id, error: null };
    }
  }

  const { data: inserted, error } = await args.supabase
    .from("email_connections")
    .insert({
      user_id: args.userId,
      provider: "gmail",
      status: "connected",
      sync_enabled: true,
      external_account_email: email,
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: expiresIso,
      scopes,
    })
    .select("id")
    .single();

  if (error) return { connectionId: null, error: error.message };
  return { connectionId: inserted.id, error: null };
}

type GmailHeader = { name?: string; value?: string };
type GmailPayload = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
  headers?: GmailHeader[];
};
type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPayload;
};

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  const found = (headers ?? []).find(
    (h) => (h.name || "").toLowerCase() === name.toLowerCase()
  );
  return (found?.value || "").trim();
}

function decodeBase64Url(data: string | undefined): string {
  if (!data) return "";
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function extractTextBody(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  const mime = (payload.mimeType || "").toLowerCase();
  if (mime === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts?.length) {
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text.trim()) return text;
    }
    // fallback: strip html
    for (const part of payload.parts) {
      const pm = (part.mimeType || "").toLowerCase();
      if (pm === "text/html" && part.body?.data) {
        return stripHtml(decodeBase64Url(part.body.data));
      }
    }
  }
  if (mime === "text/html" && payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }
  return decodeBase64Url(payload.body?.data);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseAddressList(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parseParticipant(raw: string): { name?: string | null; email: string } | null {
  const m = raw.match(/^(.*?)<([^>]+)>$/);
  if (m) {
    const email = m[2].trim();
    if (!email) return null;
    const name = m[1].replace(/"/g, "").trim();
    return { email, name: name || null };
  }
  const email = raw.trim();
  if (!email || !email.includes("@")) return null;
  return { email, name: null };
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

async function listGmailThreadIds(
  accessToken: string,
  maxResults = 25
): Promise<string[]> {
  const params = new URLSearchParams({
    maxResults: String(maxResults),
  });
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const json = (await res.json()) as {
    threads?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `Gmail list failed (${res.status})`);
  }
  return (json.threads ?? [])
    .map((t) => t.id)
    .filter((id): id is string => Boolean(id));
}

async function fetchGmailThread(
  accessToken: string,
  threadId: string
): Promise<{ id: string; messages: GmailMessage[] }> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const json = (await res.json()) as {
    id?: string;
    messages?: GmailMessage[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      json.error?.message || `Gmail thread fetch failed (${res.status})`
    );
  }
  return { id: json.id || threadId, messages: json.messages ?? [] };
}

export async function syncGmailConnection(args: {
  supabase: SupabaseClient;
  userId: string;
  connectionId: string;
}): Promise<{ imported: number; error: string | null }> {
  const { data: conn, error: findErr } = await args.supabase
    .from("email_connections")
    .select(
      "id, user_id, sync_enabled, status, access_token_enc, refresh_token_enc, token_expires_at, scopes, external_account_email"
    )
    .eq("id", args.connectionId)
    .eq("user_id", args.userId)
    .eq("provider", "gmail")
    .maybeSingle();

  if (findErr) return { imported: 0, error: findErr.message };
  if (!conn) return { imported: 0, error: "Connection not found" };
  if (!conn.sync_enabled) {
    return { imported: 0, error: "Sync is paused for this connection" };
  }

  try {
    const accessToken = await getValidAccessToken(
      args.supabase,
      conn as ConnectionSecrets
    );
    if (!connectionHasGmailScope(conn.scopes)) {
      // still try; scopes string may be incomplete after refresh
    }

    const myEmail = (conn.external_account_email || "").toLowerCase();
    const threadIds = await listGmailThreadIds(accessToken, 25);
    let imported = 0;

    for (const externalThreadId of threadIds) {
      const full = await fetchGmailThread(accessToken, externalThreadId);
      const messages = full.messages.slice(-10); // newest last; keep last 10
      if (messages.length === 0) continue;

      const participantsMap = new Map<
        string,
        { name?: string | null; email: string }
      >();
      let subject: string | null = null;
      let snippet: string | null = null;
      let lastMessageAt: string | null = null;
      let isUnread = false;

      type ParsedMsg = {
        external_message_id: string;
        from_addr: string | null;
        to_addrs: string[];
        cc_addrs: string[];
        subject: string | null;
        body_text: string | null;
        snippet: string | null;
        sent_at: string | null;
        is_from_me: boolean;
      };
      const parsed: ParsedMsg[] = [];

      for (const msg of messages) {
        const headers = msg.payload?.headers;
        const msgSubject = headerValue(headers, "Subject") || null;
        const fromRaw = headerValue(headers, "From");
        const toRaw = headerValue(headers, "To");
        const ccRaw = headerValue(headers, "Cc");
        const fromPart = parseParticipant(fromRaw);
        if (fromPart) participantsMap.set(fromPart.email.toLowerCase(), fromPart);
        for (const a of parseAddressList(toRaw)) {
          const p = parseParticipant(a);
          if (p) participantsMap.set(p.email.toLowerCase(), p);
        }
        const body = clip(extractTextBody(msg.payload), 50000);
        const msgSnippet = clip(msg.snippet || body, 1800) || null;
        const sentMs = msg.internalDate ? Number(msg.internalDate) : NaN;
        const sentAt = Number.isFinite(sentMs)
          ? new Date(sentMs).toISOString()
          : null;
        if (!subject && msgSubject) subject = clip(msgSubject, 900);
        if (msgSnippet) snippet = msgSnippet;
        if (sentAt && (!lastMessageAt || sentAt > lastMessageAt)) {
          lastMessageAt = sentAt;
        }
        if (msg.labelIds?.includes("UNREAD")) isUnread = true;
        const fromAddr = fromPart?.email || fromRaw || null;
        const isFromMe = Boolean(
          myEmail && fromAddr && fromAddr.toLowerCase().includes(myEmail)
        );
        parsed.push({
          external_message_id: msg.id,
          from_addr: fromAddr ? clip(fromAddr, 480) : null,
          to_addrs: parseAddressList(toRaw).map((a) => clip(a, 200)),
          cc_addrs: parseAddressList(ccRaw).map((a) => clip(a, 200)),
          subject: msgSubject ? clip(msgSubject, 900) : null,
          body_text: body || null,
          snippet: msgSnippet,
          sent_at: sentAt,
          is_from_me: isFromMe,
        });
      }

      const participants = [...participantsMap.values()].slice(0, 30);

      const { data: threadRow, error: upsertThreadErr } = await args.supabase
        .from("email_threads")
        .upsert(
          {
            connection_id: conn.id,
            user_id: args.userId,
            provider: "gmail",
            external_thread_id: externalThreadId,
            subject,
            snippet,
            participants,
            last_message_at: lastMessageAt,
            message_count: parsed.length,
            is_unread: isUnread,
          },
          { onConflict: "connection_id,external_thread_id" }
        )
        .select("id")
        .single();

      if (upsertThreadErr || !threadRow) {
        throw new Error(upsertThreadErr?.message || "Thread upsert failed");
      }

      for (const m of parsed) {
        const { error: msgErr } = await args.supabase
          .from("email_messages")
          .upsert(
            {
              thread_id: threadRow.id,
              connection_id: conn.id,
              user_id: args.userId,
              provider: "gmail",
              ...m,
            },
            { onConflict: "connection_id,external_message_id" }
          );
        if (msgErr) throw new Error(msgErr.message);
        imported += 1;
      }
    }

    await args.supabase
      .from("email_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: null,
        status: "connected",
      })
      .eq("id", conn.id)
      .eq("user_id", args.userId);

    return { imported, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gmail sync failed";
    await args.supabase
      .from("email_connections")
      .update({ last_error: clip(msg, 500), status: "error" })
      .eq("id", conn.id)
      .eq("user_id", args.userId);
    return { imported: 0, error: msg };
  }
}

export async function syncAllGmailConnections(args: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<{ imported: number; errors: string[] }> {
  const { data: rows } = await args.supabase
    .from("email_connections")
    .select("id")
    .eq("user_id", args.userId)
    .eq("provider", "gmail")
    .eq("status", "connected")
    .eq("sync_enabled", true);

  let imported = 0;
  const errors: string[] = [];
  for (const row of rows ?? []) {
    const result = await syncGmailConnection({
      supabase: args.supabase,
      userId: args.userId,
      connectionId: row.id,
    });
    imported += result.imported;
    if (result.error) errors.push(result.error);
  }
  return { imported, errors };
}
