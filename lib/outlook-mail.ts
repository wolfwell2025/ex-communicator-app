import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "./crypto-tokens";
import {
  OUTLOOK_MAIL_SCOPES,
  connectionHasOutlookMailScope,
} from "./email-scopes";
import { getSiteUrl } from "./supabase/env";

/**
 * HARD PRIVACY RULE:
 * Outlook mail sync ALWAYS stores threads/messages as owner-private (RLS user_id).
 * Co-parent never sees imported email until the owner explicitly drafts into
 * parenting-team Messages. Never auto-share on connect/sync.
 *
 * IMPORTANT: Mail OAuth is SEPARATE from Outlook Calendar OAuth.
 * Calendar uses Calendars.ReadWrite; mail uses Mail.Read. Connecting calendars
 * does not grant mail access, and connecting mail does not grant calendar.
 * Users must reconnect each product surface separately.
 */

export {
  OUTLOOK_MAIL_SCOPES,
  connectionHasOutlookMailScope,
} from "./email-scopes";

export type OutlookMailTokenResponse = {
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

function microsoftTenant(): string {
  return process.env.MICROSOFT_TENANT_ID?.trim() || "common";
}

export function outlookMailOAuthConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID?.trim() &&
      process.env.MICROSOFT_CLIENT_SECRET?.trim()
  );
}

export function getOutlookMailRedirectUri(): string {
  const override = process.env.MICROSOFT_MAIL_REDIRECT_URI?.trim().replace(
    /\/$/,
    ""
  );
  if (override) return override;
  return `${getSiteUrl()}/api/email/outlook/callback`;
}

export function buildOutlookMailAuthUrl(state: string): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  if (!clientId) throw new Error("Missing MICROSOFT_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getOutlookMailRedirectUri(),
    response_type: "code",
    scope: OUTLOOK_MAIL_SCOPES,
    response_mode: "query",
    prompt: "select_account",
    state,
  });
  return `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeOutlookMailCode(
  code: string
): Promise<OutlookMailTokenResponse> {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET");
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getOutlookMailRedirectUri(),
    grant_type: "authorization_code",
    scope: OUTLOOK_MAIL_SCOPES,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  const json = (await res.json()) as OutlookMailTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ||
        json.error ||
        `Token exchange failed (${res.status})`
    );
  }
  return json;
}

export async function refreshOutlookMailAccessToken(
  refreshToken: string
): Promise<OutlookMailTokenResponse> {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: OUTLOOK_MAIL_SCOPES,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  const json = (await res.json()) as OutlookMailTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ||
        json.error ||
        `Token refresh failed (${res.status})`
    );
  }
  return json;
}

export async function fetchOutlookUserEmail(
  accessToken: string
): Promise<string | null> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    mail?: string;
    userPrincipalName?: string;
  };
  return json.mail || json.userPrincipalName || null;
}

function mergeScopes(...parts: (string | null | undefined)[]): string {
  const set = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const s of part.split(/\s+/).filter(Boolean)) set.add(s);
  }
  return [...set].join(" ");
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
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

async function getValidAccessToken(
  supabase: SupabaseClient,
  connection: ConnectionSecrets
): Promise<string> {
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;
  if (connection.access_token_enc && expiresAt > Date.now() + 60_000) {
    return decryptSecret(connection.access_token_enc);
  }
  if (!connection.refresh_token_enc) {
    throw new Error("Missing refresh token; reconnect Outlook mail");
  }
  const refreshToken = decryptSecret(connection.refresh_token_enc);
  const refreshed = await refreshOutlookMailAccessToken(refreshToken);
  const accessEnc = encryptSecret(refreshed.access_token);
  const expires = new Date(
    Date.now() + (refreshed.expires_in || 3600) * 1000
  ).toISOString();
  await supabase
    .from("email_connections")
    .update({
      access_token_enc: accessEnc,
      token_expires_at: expires,
      scopes: mergeScopes(
        refreshed.scope,
        connection.scopes,
        OUTLOOK_MAIL_SCOPES
      ),
      last_error: null,
    })
    .eq("id", connection.id)
    .eq("user_id", connection.user_id);
  return refreshed.access_token;
}

export async function upsertOutlookMailConnection(args: {
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
  const scopes = mergeScopes(args.scopes, OUTLOOK_MAIL_SCOPES);
  const expiresIso = new Date(args.expiresAt).toISOString();

  const { data: existing } = await args.supabase
    .from("email_connections")
    .select("id, refresh_token_enc")
    .eq("user_id", args.userId)
    .eq("provider", "outlook")
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

  if (email) {
    const { data: nullEmail } = await args.supabase
      .from("email_connections")
      .select("id, refresh_token_enc")
      .eq("user_id", args.userId)
      .eq("provider", "outlook")
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
      provider: "outlook",
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

type GraphRecipient = {
  emailAddress?: { name?: string; address?: string };
};

type GraphMessage = {
  id?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
};

function recipientEmail(r: GraphRecipient | undefined): string | null {
  const addr = r?.emailAddress?.address?.trim();
  return addr || null;
}

function recipientLabel(r: GraphRecipient | undefined): {
  name?: string | null;
  email: string;
} | null {
  const email = recipientEmail(r);
  if (!email) return null;
  const name = r?.emailAddress?.name?.trim() || null;
  return { email, name };
}

async function listRecentOutlookMessages(
  accessToken: string,
  top = 40
): Promise<GraphMessage[]> {
  const select = [
    "id",
    "conversationId",
    "subject",
    "bodyPreview",
    "body",
    "from",
    "toRecipients",
    "ccRecipients",
    "receivedDateTime",
    "sentDateTime",
    "isRead",
  ].join(",");
  const url =
    `https://graph.microsoft.com/v1.0/me/messages?$top=${top}` +
    `&$orderby=receivedDateTime desc` +
    `&$select=${select}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="text"',
    },
  });
  const json = (await res.json()) as {
    value?: GraphMessage[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      json.error?.message || `Outlook mail list failed (${res.status})`
    );
  }
  return json.value ?? [];
}

export async function syncOutlookMailConnection(args: {
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
    .eq("provider", "outlook")
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
    void connectionHasOutlookMailScope;

    const myEmail = (conn.external_account_email || "").toLowerCase();
    const messages = await listRecentOutlookMessages(accessToken, 40);

    type Bucket = {
      conversationId: string;
      messages: GraphMessage[];
    };
    const byConv = new Map<string, Bucket>();
    for (const msg of messages) {
      const cid = msg.conversationId || msg.id;
      if (!cid || !msg.id) continue;
      const bucket = byConv.get(cid) ?? { conversationId: cid, messages: [] };
      bucket.messages.push(msg);
      byConv.set(cid, bucket);
    }

    let imported = 0;

    for (const bucket of byConv.values()) {
      const sorted = [...bucket.messages].sort((a, b) => {
        const ta = new Date(
          a.receivedDateTime || a.sentDateTime || 0
        ).getTime();
        const tb = new Date(
          b.receivedDateTime || b.sentDateTime || 0
        ).getTime();
        return ta - tb;
      });
      const keep = sorted.slice(-10);

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

      for (const msg of keep) {
        const fromPart = recipientLabel(msg.from);
        if (fromPart) {
          participantsMap.set(fromPart.email.toLowerCase(), fromPart);
        }
        for (const r of msg.toRecipients ?? []) {
          const p = recipientLabel(r);
          if (p) participantsMap.set(p.email.toLowerCase(), p);
        }
        const rawBody =
          msg.body?.contentType?.toLowerCase() === "html"
            ? stripHtml(msg.body.content || "")
            : msg.body?.content || "";
        const bodyText = clip(rawBody || msg.bodyPreview || "", 50000);
        const msgSnippet = clip(msg.bodyPreview || bodyText, 1800) || null;
        const sentAtRaw = msg.receivedDateTime || msg.sentDateTime || null;
        const sentAt = sentAtRaw ? new Date(sentAtRaw).toISOString() : null;
        if (!subject && msg.subject) subject = clip(msg.subject, 900);
        if (msgSnippet) snippet = msgSnippet;
        if (sentAt && (!lastMessageAt || sentAt > lastMessageAt)) {
          lastMessageAt = sentAt;
        }
        if (msg.isRead === false) isUnread = true;
        const fromAddr = fromPart?.email || null;
        const isFromMe = Boolean(
          myEmail && fromAddr && fromAddr.toLowerCase() === myEmail
        );
        parsed.push({
          external_message_id: msg.id!,
          from_addr: fromAddr ? clip(fromAddr, 480) : null,
          to_addrs: (msg.toRecipients ?? [])
            .map((r) => recipientEmail(r))
            .filter((e): e is string => Boolean(e))
            .map((e) => clip(e, 200))
            .slice(0, 20),
          cc_addrs: (msg.ccRecipients ?? [])
            .map((r) => recipientEmail(r))
            .filter((e): e is string => Boolean(e))
            .map((e) => clip(e, 200))
            .slice(0, 20),
          subject: msg.subject ? clip(msg.subject, 900) : null,
          body_text: bodyText || null,
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
            provider: "outlook",
            external_thread_id: bucket.conversationId,
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
              provider: "outlook",
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
    const msg = e instanceof Error ? e.message : "Outlook mail sync failed";
    await args.supabase
      .from("email_connections")
      .update({ last_error: clip(msg, 500), status: "error" })
      .eq("id", conn.id)
      .eq("user_id", args.userId);
    return { imported: 0, error: msg };
  }
}

export async function syncAllOutlookMailConnections(args: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<{ imported: number; errors: string[] }> {
  const { data: rows } = await args.supabase
    .from("email_connections")
    .select("id")
    .eq("user_id", args.userId)
    .eq("provider", "outlook")
    .eq("status", "connected")
    .eq("sync_enabled", true);

  let imported = 0;
  const errors: string[] = [];
  for (const row of rows ?? []) {
    const result = await syncOutlookMailConnection({
      supabase: args.supabase,
      userId: args.userId,
      connectionId: row.id,
    });
    imported += result.imported;
    if (result.error) errors.push(result.error);
  }
  return { imported, errors };
}
