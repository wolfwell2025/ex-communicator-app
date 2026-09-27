import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "./crypto-tokens";
import { getSiteUrl } from "./supabase/env";
import {
  OUTLOOK_CALENDAR_SCOPES,
  outlookConnectionHasWriteScope,
} from "./outlook-calendar-scopes";

/**
 * HARD PRIVACY RULE:
 * Outlook sync ALWAYS imports as visibility=private + source=outlook.
 * Co-parent never sees imported events until the owner explicitly proposes
 * and the co-parent accepts in-app. Never auto-share on connect/sync.
 */

export {
  OUTLOOK_CALENDAR_SCOPES,
  outlookConnectionHasWriteScope,
} from "./outlook-calendar-scopes";

export type OutlookTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

export type OutlookCalendarListEntry = {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  canEdit?: boolean;
};

export type PendingOutlookAuth = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string | null;
  email: string | null;
};

type ConnectionSecrets = {
  id: string;
  user_id: string;
  external_calendar_id: string | null;
  sync_enabled: boolean;
  export_enabled?: boolean;
  status: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  scopes: string | null;
};

function microsoftTenant(): string {
  return process.env.MICROSOFT_TENANT_ID?.trim() || "common";
}

export function outlookOAuthConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID?.trim() &&
      process.env.MICROSOFT_CLIENT_SECRET?.trim()
  );
}

export function getOutlookRedirectUri(): string {
  const override = process.env.MICROSOFT_REDIRECT_URI?.trim().replace(/\/$/, "");
  if (override) return override;
  return `${getSiteUrl()}/api/calendar/outlook/callback`;
}

export function buildOutlookAuthUrl(state: string): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  if (!clientId) throw new Error("Missing MICROSOFT_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getOutlookRedirectUri(),
    response_type: "code",
    scope: OUTLOOK_CALENDAR_SCOPES,
    response_mode: "query",
    prompt: "select_account",
    state,
  });
  return `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeOutlookCode(
  code: string
): Promise<OutlookTokenResponse> {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET");
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getOutlookRedirectUri(),
    grant_type: "authorization_code",
    scope: OUTLOOK_CALENDAR_SCOPES,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  const json = (await res.json()) as OutlookTokenResponse & {
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

export async function refreshOutlookAccessToken(
  refreshToken: string
): Promise<OutlookTokenResponse> {
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
    scope: OUTLOOK_CALENDAR_SCOPES,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  const json = (await res.json()) as OutlookTokenResponse & {
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

export async function listOutlookCalendars(
  accessToken: string
): Promise<OutlookCalendarListEntry[]> {
  const calendars: OutlookCalendarListEntry[] = [];
  let url: string | null =
    "https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,isDefaultCalendar,canEdit&$top=50";

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json()) as {
      value?: Array<{
        id?: string;
        name?: string;
        isDefaultCalendar?: boolean;
        canEdit?: boolean;
      }>;
      "@odata.nextLink"?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(
        json.error?.message || `Calendar list failed (${res.status})`
      );
    }
    for (const item of json.value ?? []) {
      if (!item.id) continue;
      calendars.push({
        id: item.id,
        summary: item.name || item.id,
        primary: Boolean(item.isDefaultCalendar),
        canEdit: item.canEdit,
      });
    }
    url = json["@odata.nextLink"] ?? null;
  }

  calendars.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return a.summary.localeCompare(b.summary);
  });
  return calendars;
}

type OutlookEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  location?: { displayName?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
};

async function listUpcomingOutlookEvents(
  accessToken: string,
  calendarId: string,
  options?: { daysAhead?: number; maxResults?: number }
): Promise<OutlookEvent[]> {
  const daysAhead = options?.daysAhead ?? 90;
  const maxResults = options?.maxResults ?? 100;
  const start = new Date().toISOString();
  const end = new Date(
    Date.now() + daysAhead * 24 * 60 * 60 * 1000
  ).toISOString();
  const events: OutlookEvent[] = [];
  const encodedId = encodeURIComponent(calendarId);
  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/calendars/${encodedId}/calendarView` +
    `?startDateTime=${encodeURIComponent(start)}` +
    `&endDateTime=${encodeURIComponent(end)}` +
    `&$select=id,subject,bodyPreview,body,location,isAllDay,isCancelled,start,end` +
    `&$orderby=start/dateTime` +
    `&$top=${Math.min(50, maxResults)}`;

  while (url && events.length < maxResults) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    const json = (await res.json()) as {
      value?: OutlookEvent[];
      "@odata.nextLink"?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(
        json.error?.message || `Events list failed (${res.status})`
      );
    }
    for (const item of json.value ?? []) {
      if (item.isCancelled) continue;
      events.push(item);
      if (events.length >= maxResults) break;
    }
    url = events.length < maxResults ? (json["@odata.nextLink"] ?? null) : null;
  }

  return events;
}

function outlookEventToRow(event: OutlookEvent): {
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
} | null {
  const allDay = Boolean(event.isAllDay);
  const startRaw = event.start?.dateTime || event.start?.date;
  const endRaw = event.end?.dateTime || event.end?.date;
  if (!startRaw || !endRaw) return null;

  let starts_at: string;
  let ends_at: string;

  if (allDay) {
    // Graph all-day: dateTime is midnight UTC of the day; end is exclusive
    const startDay = startRaw.slice(0, 10);
    const endExclusive = endRaw.slice(0, 10);
    starts_at = new Date(`${startDay}T00:00:00`).toISOString();
    const endInclusive = new Date(`${endExclusive}T00:00:00`);
    endInclusive.setMilliseconds(endInclusive.getMilliseconds() - 1);
    ends_at = endInclusive.toISOString();
    if (ends_at < starts_at) {
      ends_at = new Date(`${startDay}T23:59:59`).toISOString();
    }
  } else {
    // Graph dateTime often lacks Z; treat as UTC when Prefer outlook.timezone=UTC
    const normalize = (s: string) =>
      /Z$|[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`;
    starts_at = new Date(normalize(startRaw)).toISOString();
    ends_at = new Date(normalize(endRaw)).toISOString();
  }

  if (ends_at < starts_at) return null;
  const title = (event.subject || "(No title)").trim().slice(0, 200);
  if (!title) return null;

  const bodyText =
    event.body?.contentType === "text"
      ? event.body.content
      : event.bodyPreview;

  return {
    title,
    description: bodyText?.trim().slice(0, 5000) || null,
    starts_at,
    ends_at,
    all_day: allDay,
    location: event.location?.displayName?.trim().slice(0, 300) || null,
  };
}

async function getValidAccessToken(
  supabase: SupabaseClient,
  connection: ConnectionSecrets
): Promise<string> {
  if (!connection.access_token_enc) {
    throw new Error("No access token stored. Reconnect Outlook Calendar.");
  }
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;
  if (expiresAt > Date.now() + 60_000) {
    return decryptSecret(connection.access_token_enc);
  }
  if (!connection.refresh_token_enc) {
    throw new Error("Outlook access expired and no refresh token. Reconnect.");
  }
  const refreshToken = decryptSecret(connection.refresh_token_enc);
  const refreshed = await refreshOutlookAccessToken(refreshToken);
  const accessEnc = encryptSecret(refreshed.access_token);
  const expires = new Date(
    Date.now() + (refreshed.expires_in || 3600) * 1000
  ).toISOString();
  const newRefreshEnc = refreshed.refresh_token
    ? encryptSecret(refreshed.refresh_token)
    : connection.refresh_token_enc;

  await supabase
    .from("personal_calendar_connections")
    .update({
      access_token_enc: accessEnc,
      refresh_token_enc: newRefreshEnc,
      token_expires_at: expires,
      scopes: mergeOutlookScopes(refreshed.scope, connection.scopes),
    })
    .eq("user_id", connection.user_id)
    .eq("provider", "outlook")
    .eq("refresh_token_enc", connection.refresh_token_enc);

  return refreshed.access_token;
}

export function encodePendingOutlookAuth(pending: PendingOutlookAuth): string {
  return encryptSecret(JSON.stringify(pending));
}

export function decodePendingOutlookAuth(payload: string): PendingOutlookAuth {
  return JSON.parse(decryptSecret(payload)) as PendingOutlookAuth;
}

/** Union space-separated OAuth scope strings. */
export function mergeOutlookScopes(
  ...parts: (string | null | undefined)[]
): string {
  const set = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const s of part.split(/\s+/).filter(Boolean)) set.add(s);
  }
  return [...set].join(" ");
}

/**
 * After a fresh OAuth consent, push new tokens + merged scopes onto every
 * existing Outlook connection for this user + account email so Export / write
 * scope unlocks without forcing the calendar picker.
 */
export async function upgradeOutlookAccountTokens(args: {
  supabase: SupabaseClient;
  userId: string;
  pending: PendingOutlookAuth;
}): Promise<{ upgraded: number; hasWriteScope: boolean; error: string | null }> {
  const email = args.pending.email?.trim() || null;
  if (!email) {
    return {
      upgraded: 0,
      hasWriteScope: outlookConnectionHasWriteScope(
        mergeOutlookScopes(args.pending.scopes, OUTLOOK_CALENDAR_SCOPES)
      ),
      error: null,
    };
  }

  const { data: rows, error: listErr } = await args.supabase
    .from("personal_calendar_connections")
    .select(
      "id, scopes, refresh_token_enc, access_token_enc, token_expires_at"
    )
    .eq("user_id", args.userId)
    .eq("provider", "outlook")
    .eq("external_account_email", email)
    .eq("status", "connected");

  if (listErr) {
    return { upgraded: 0, hasWriteScope: false, error: listErr.message };
  }
  if (!rows?.length) {
    return {
      upgraded: 0,
      hasWriteScope: outlookConnectionHasWriteScope(
        mergeOutlookScopes(args.pending.scopes, OUTLOOK_CALENDAR_SCOPES)
      ),
      error: null,
    };
  }

  const accessEnc = encryptSecret(args.pending.accessToken);
  const newRefreshEnc = args.pending.refreshToken
    ? encryptSecret(args.pending.refreshToken)
    : null;
  const expires = new Date(args.pending.expiresAt).toISOString();

  let upgraded = 0;
  let anyWrite = false;
  let lastError: string | null = null;

  for (const row of rows) {
    const mergedScopes = mergeOutlookScopes(
      args.pending.scopes,
      row.scopes,
      OUTLOOK_CALENDAR_SCOPES
    );
    if (outlookConnectionHasWriteScope(mergedScopes)) anyWrite = true;

    const refreshEnc = newRefreshEnc ?? row.refresh_token_enc ?? null;
    const { error } = await args.supabase
      .from("personal_calendar_connections")
      .update({
        access_token_enc: accessEnc,
        refresh_token_enc: refreshEnc,
        token_expires_at: expires,
        scopes: mergedScopes,
        status: "connected",
      })
      .eq("id", row.id)
      .eq("user_id", args.userId);

    if (error) {
      lastError = error.message;
      continue;
    }
    upgraded += 1;
  }

  return {
    upgraded,
    hasWriteScope:
      anyWrite ||
      outlookConnectionHasWriteScope(
        mergeOutlookScopes(args.pending.scopes, OUTLOOK_CALENDAR_SCOPES)
      ),
    error: upgraded === 0 ? lastError : null,
  };
}

/** Create or update one Outlook calendar connection. Sync imports stay private. */
export async function saveOutlookCalendarConnection(args: {
  supabase: SupabaseClient;
  userId: string;
  pending: PendingOutlookAuth;
  calendarId: string;
  calendarSummary: string;
  label?: string;
  syncEnabled?: boolean;
}): Promise<{ connectionId: string; error: string | null }> {
  const accessEnc = encryptSecret(args.pending.accessToken);
  const refreshEnc = args.pending.refreshToken
    ? encryptSecret(args.pending.refreshToken)
    : null;
  const expires = new Date(args.pending.expiresAt).toISOString();
  const label =
    (args.label?.trim() || args.calendarSummary || "Outlook calendar").slice(
      0,
      120
    );

  let refreshToStore = refreshEnc;
  if (!refreshToStore && args.pending.email) {
    const { data: sibling } = await args.supabase
      .from("personal_calendar_connections")
      .select("refresh_token_enc")
      .eq("user_id", args.userId)
      .eq("provider", "outlook")
      .eq("external_account_email", args.pending.email)
      .not("refresh_token_enc", "is", null)
      .limit(1)
      .maybeSingle();
    refreshToStore = sibling?.refresh_token_enc ?? null;
  }

  const { data: existing } = await args.supabase
    .from("personal_calendar_connections")
    .select("id")
    .eq("user_id", args.userId)
    .eq("provider", "outlook")
    .eq("external_account_email", args.pending.email)
    .eq("external_calendar_id", args.calendarId)
    .maybeSingle();

  const payload = {
    user_id: args.userId,
    provider: "outlook" as const,
    status: "connected" as const,
    label,
    sync_enabled: args.syncEnabled ?? true,
    external_account_email: args.pending.email,
    external_calendar_id: args.calendarId,
    access_token_enc: accessEnc,
    refresh_token_enc: refreshToStore,
    token_expires_at: expires,
    scopes: mergeOutlookScopes(args.pending.scopes, OUTLOOK_CALENDAR_SCOPES),
  };

  if (existing?.id) {
    const { error } = await args.supabase
      .from("personal_calendar_connections")
      .update(payload)
      .eq("id", existing.id);
    if (error) return { connectionId: "", error: error.message };
    return { connectionId: existing.id as string, error: null };
  }

  const { data, error } = await args.supabase
    .from("personal_calendar_connections")
    .insert(payload)
    .select("id")
    .single();

  if (error || !data) {
    return { connectionId: "", error: error?.message ?? "Insert failed" };
  }
  return { connectionId: data.id as string, error: null };
}

/**
 * Import upcoming events as PRIVATE only (source=outlook).
 * Never sets visibility to pending/shared.
 */
export async function syncOutlookCalendarEvents(args: {
  supabase: SupabaseClient;
  userId: string;
  householdId: string;
  connectionId: string;
}): Promise<{ imported: number; error: string | null }> {
  const { data: conn, error: connErr } = await args.supabase
    .from("personal_calendar_connections")
    .select(
      "id, user_id, external_calendar_id, sync_enabled, status, access_token_enc, refresh_token_enc, token_expires_at, scopes"
    )
    .eq("id", args.connectionId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (connErr) return { imported: 0, error: connErr.message };
  if (!conn) return { imported: 0, error: "Connection not found." };
  if (conn.status !== "connected") {
    return { imported: 0, error: "Calendar is not connected." };
  }
  if (!conn.sync_enabled) {
    return { imported: 0, error: null };
  }
  if (!conn.external_calendar_id) {
    return { imported: 0, error: "No Outlook calendar id on connection." };
  }

  const connection = conn as ConnectionSecrets;
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(args.supabase, connection);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token error";
    await args.supabase
      .from("personal_calendar_connections")
      .update({ status: "error" })
      .eq("id", connection.id);
    return { imported: 0, error: msg };
  }

  let outlookEvents: OutlookEvent[];
  try {
    outlookEvents = await listUpcomingOutlookEvents(
      accessToken,
      connection.external_calendar_id!
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Calendar fetch failed";
    return { imported: 0, error: msg };
  }

  let imported = 0;
  for (const oe of outlookEvents) {
    const mapped = outlookEventToRow(oe);
    if (!mapped) continue;

    const row = {
      household_id: args.householdId,
      created_by: args.userId,
      title: mapped.title,
      description: mapped.description,
      starts_at: mapped.starts_at,
      ends_at: mapped.ends_at,
      all_day: mapped.all_day,
      location: mapped.location,
      event_type: "other" as const,
      visibility: "private" as const,
      source: "outlook" as const,
      external_id: oe.id,
      connection_id: connection.id,
      proposed_at: null,
      proposed_by: null,
      accepted_at: null,
      accepted_by: null,
    };

    const { data: existing } = await args.supabase
      .from("calendar_events")
      .select("id, visibility")
      .eq("connection_id", connection.id)
      .eq("external_id", oe.id)
      .maybeSingle();

    if (existing?.id) {
      const { error: updErr } = await args.supabase
        .from("calendar_events")
        .update({
          title: row.title,
          description: row.description,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          all_day: row.all_day,
          location: row.location,
        })
        .eq("id", existing.id)
        .eq("created_by", args.userId);
      if (updErr) continue;
    } else {
      const { error: insErr } = await args.supabase
        .from("calendar_events")
        .insert(row);
      if (insErr) continue;
    }
    imported += 1;
  }

  await args.supabase
    .from("personal_calendar_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      status: "connected",
    })
    .eq("id", connection.id);

  return { imported, error: null };
}

export async function syncAllEnabledOutlookCalendars(args: {
  supabase: SupabaseClient;
  userId: string;
  householdId: string;
}): Promise<{ imported: number; errors: string[] }> {
  const { data: conns } = await args.supabase
    .from("personal_calendar_connections")
    .select("id")
    .eq("user_id", args.userId)
    .eq("provider", "outlook")
    .eq("status", "connected")
    .eq("sync_enabled", true);

  let imported = 0;
  const errors: string[] = [];
  for (const c of conns ?? []) {
    const result = await syncOutlookCalendarEvents({
      supabase: args.supabase,
      userId: args.userId,
      householdId: args.householdId,
      connectionId: c.id as string,
    });
    imported += result.imported;
    if (result.error) errors.push(result.error);
  }
  return { imported, errors };
}

export async function setOutlookConnectionSyncEnabled(args: {
  supabase: SupabaseClient;
  userId: string;
  connectionId: string;
  syncEnabled: boolean;
}): Promise<{ error: string | null }> {
  const { error } = await args.supabase
    .from("personal_calendar_connections")
    .update({ sync_enabled: args.syncEnabled })
    .eq("id", args.connectionId)
    .eq("user_id", args.userId)
    .eq("provider", "outlook");
  return { error: error?.message ?? null };
}

export async function setOutlookConnectionExportEnabled(args: {
  supabase: SupabaseClient;
  userId: string;
  connectionId: string;
  exportEnabled: boolean;
}): Promise<{ error: string | null }> {
  const { error } = await args.supabase
    .from("personal_calendar_connections")
    .update({ export_enabled: args.exportEnabled })
    .eq("id", args.connectionId)
    .eq("user_id", args.userId)
    .eq("provider", "outlook");
  return { error: error?.message ?? null };
}

export async function updateOutlookConnectionLabel(args: {
  supabase: SupabaseClient;
  userId: string;
  connectionId: string;
  label: string;
}): Promise<{ error: string | null }> {
  const label = args.label.trim().slice(0, 120);
  if (!label) return { error: "Label is required." };
  const { error } = await args.supabase
    .from("personal_calendar_connections")
    .update({ label })
    .eq("id", args.connectionId)
    .eq("user_id", args.userId)
    .eq("provider", "outlook");
  return { error: error?.message ?? null };
}

export async function disconnectOutlookCalendarConnection(args: {
  supabase: SupabaseClient;
  userId: string;
  connectionId: string;
  removeImportedEvents?: boolean;
}): Promise<{ error: string | null }> {
  const { data: conn } = await args.supabase
    .from("personal_calendar_connections")
    .select("id")
    .eq("id", args.connectionId)
    .eq("user_id", args.userId)
    .eq("provider", "outlook")
    .maybeSingle();

  if (!conn) return { error: null };

  if (args.removeImportedEvents) {
    await args.supabase
      .from("calendar_events")
      .delete()
      .eq("connection_id", conn.id)
      .eq("created_by", args.userId)
      .eq("source", "outlook");
  }

  const { error } = await args.supabase
    .from("personal_calendar_connections")
    .delete()
    .eq("id", conn.id)
    .eq("user_id", args.userId);

  return { error: error?.message ?? null };
}

/** Load pending auth from an existing connected Outlook row. */
export async function pendingOutlookFromConnection(
  supabase: SupabaseClient,
  userId: string,
  connectionId: string
): Promise<{ pending: PendingOutlookAuth | null; error: string | null }> {
  const { data: conn, error } = await supabase
    .from("personal_calendar_connections")
    .select(
      "id, user_id, external_calendar_id, sync_enabled, status, access_token_enc, refresh_token_enc, token_expires_at, scopes, external_account_email"
    )
    .eq("id", connectionId)
    .eq("user_id", userId)
    .eq("provider", "outlook")
    .maybeSingle();

  if (error) return { pending: null, error: error.message };
  if (!conn) return { pending: null, error: "Connection not found." };

  try {
    const accessToken = await getValidAccessToken(
      supabase,
      conn as ConnectionSecrets
    );
    return {
      pending: {
        accessToken,
        refreshToken: conn.refresh_token_enc
          ? decryptSecret(conn.refresh_token_enc)
          : null,
        expiresAt: conn.token_expires_at
          ? new Date(conn.token_expires_at).getTime()
          : Date.now() + 3600_000,
        scopes: conn.scopes,
        email: conn.external_account_email,
      },
      error: null,
    };
  } catch (e) {
    return {
      pending: null,
      error: e instanceof Error ? e.message : "Token error",
    };
  }
}

export type OutlookExportEvent = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  external_id: string | null;
  connection_id: string | null;
  created_by: string;
  visibility: string;
  source: string;
};

function toOutlookEventBody(event: OutlookExportEvent): Record<string, unknown> {
  const subject = event.title.slice(0, 200);
  const bodyContent = event.description?.slice(0, 5000) || undefined;
  const locationName = event.location?.slice(0, 300) || undefined;

  if (event.all_day) {
    const startDay = event.starts_at.slice(0, 10);
    const endInclusive = new Date(event.ends_at);
    const endExclusive = new Date(
      Date.UTC(
        endInclusive.getUTCFullYear(),
        endInclusive.getUTCMonth(),
        endInclusive.getUTCDate() + 1
      )
    );
    const endDay = endExclusive.toISOString().slice(0, 10);
    return {
      subject,
      body: bodyContent
        ? { contentType: "text", content: bodyContent }
        : undefined,
      location: locationName ? { displayName: locationName } : undefined,
      isAllDay: true,
      start: { dateTime: `${startDay}T00:00:00`, timeZone: "UTC" },
      end: { dateTime: `${endDay}T00:00:00`, timeZone: "UTC" },
    };
  }

  return {
    subject,
    body: bodyContent
      ? { contentType: "text", content: bodyContent }
      : undefined,
    location: locationName ? { displayName: locationName } : undefined,
    isAllDay: false,
    start: {
      dateTime: new Date(event.starts_at).toISOString().replace(/\.\d{3}Z$/, ""),
      timeZone: "UTC",
    },
    end: {
      dateTime: new Date(event.ends_at).toISOString().replace(/\.\d{3}Z$/, ""),
      timeZone: "UTC",
    },
  };
}

async function outlookUpsertEvent(
  accessToken: string,
  calendarId: string,
  event: OutlookExportEvent,
  existingOutlookId: string | null
): Promise<string> {
  const encodedCal = encodeURIComponent(calendarId);
  const body = toOutlookEventBody(event);

  if (existingOutlookId) {
    const encodedEv = encodeURIComponent(existingOutlookId);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${encodedCal}/events/${encodedEv}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    const json = (await res.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (res.ok && json.id) return json.id;
    if (res.status !== 404) {
      throw new Error(
        json.error?.message || `Outlook update failed (${res.status})`
      );
    }
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendars/${encodedCal}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const json = (await res.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.id) {
    throw new Error(
      json.error?.message || `Outlook create failed (${res.status})`
    );
  }
  return json.id;
}

async function outlookDeleteEvent(
  accessToken: string,
  calendarId: string,
  outlookEventId: string
): Promise<void> {
  const encodedCal = encodeURIComponent(calendarId);
  const encodedEv = encodeURIComponent(outlookEventId);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendars/${encodedCal}/events/${encodedEv}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (res.status === 404 || res.status === 410 || res.status === 204) return;
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      json.error?.message || `Outlook delete failed (${res.status})`
    );
  }
}

/**
 * Push an app-owned event to the user's export-enabled Outlook calendars.
 * Never pushes another person's private events. source=outlook imports skipped.
 */
export async function exportEventToOutlook(args: {
  supabase: SupabaseClient;
  userId: string;
  event: OutlookExportEvent;
}): Promise<{
  exported: number;
  outlookEventId: string | null;
  error: string | null;
}> {
  if (args.event.created_by !== args.userId) {
    return { exported: 0, outlookEventId: null, error: null };
  }
  if (!["private", "pending", "shared"].includes(args.event.visibility)) {
    return { exported: 0, outlookEventId: null, error: null };
  }
  if (args.event.source === "outlook" || args.event.source === "google") {
    return { exported: 0, outlookEventId: null, error: null };
  }

  const { data: conns, error: connErr } = await args.supabase
    .from("personal_calendar_connections")
    .select(
      "id, user_id, external_calendar_id, sync_enabled, export_enabled, status, access_token_enc, refresh_token_enc, token_expires_at, scopes"
    )
    .eq("user_id", args.userId)
    .eq("provider", "outlook")
    .eq("status", "connected")
    .eq("export_enabled", true);

  if (connErr) {
    return { exported: 0, outlookEventId: null, error: connErr.message };
  }
  if (!conns?.length) {
    return { exported: 0, outlookEventId: null, error: null };
  }

  let exported = 0;
  let primaryOutlookId: string | null = args.event.external_id;
  let primaryConnectionId: string | null = args.event.connection_id;
  const errors: string[] = [];

  for (const raw of conns) {
    const conn = raw as ConnectionSecrets & { export_enabled?: boolean };
    if (!conn.external_calendar_id) continue;
    if (!outlookConnectionHasWriteScope(conn.scopes)) {
      errors.push(
        "Reconnect Outlook for two-way sync (write scope missing)."
      );
      continue;
    }

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(args.supabase, conn);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Token error");
      continue;
    }

    const existingId =
      args.event.connection_id === conn.id ? args.event.external_id : null;

    try {
      const outlookId = await outlookUpsertEvent(
        accessToken,
        conn.external_calendar_id,
        args.event,
        existingId
      );
      exported += 1;
      if (!primaryConnectionId || primaryConnectionId === conn.id) {
        primaryOutlookId = outlookId;
        primaryConnectionId = conn.id;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Export failed");
    }
  }

  if (
    exported > 0 &&
    primaryOutlookId &&
    primaryConnectionId &&
    (primaryOutlookId !== args.event.external_id ||
      primaryConnectionId !== args.event.connection_id)
  ) {
    await args.supabase
      .from("calendar_events")
      .update({
        external_id: primaryOutlookId,
        connection_id: primaryConnectionId,
      })
      .eq("id", args.event.id)
      .eq("created_by", args.userId);
  }

  return {
    exported,
    outlookEventId: primaryOutlookId,
    error: exported === 0 && errors.length ? errors[0] : null,
  };
}

export async function deleteExportedOutlookEvent(args: {
  supabase: SupabaseClient;
  userId: string;
  event: Pick<
    OutlookExportEvent,
    "external_id" | "connection_id" | "created_by" | "source"
  >;
}): Promise<{ error: string | null }> {
  if (args.event.created_by !== args.userId) return { error: null };
  if (args.event.source === "outlook" || args.event.source === "google") {
    return { error: null };
  }
  if (!args.event.external_id || !args.event.connection_id) return { error: null };

  const { data: conn } = await args.supabase
    .from("personal_calendar_connections")
    .select(
      "id, user_id, external_calendar_id, sync_enabled, export_enabled, status, access_token_enc, refresh_token_enc, token_expires_at, scopes"
    )
    .eq("id", args.event.connection_id)
    .eq("user_id", args.userId)
    .eq("provider", "outlook")
    .maybeSingle();

  if (!conn?.external_calendar_id) return { error: null };
  if (!(conn as { export_enabled?: boolean }).export_enabled) return { error: null };
  if (!outlookConnectionHasWriteScope(conn.scopes)) {
    return {
      error: "Reconnect Outlook for two-way sync (write scope missing).",
    };
  }

  try {
    const accessToken = await getValidAccessToken(
      args.supabase,
      conn as ConnectionSecrets
    );
    await outlookDeleteEvent(
      accessToken,
      conn.external_calendar_id,
      args.event.external_id
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Outlook delete failed" };
  }
  return { error: null };
}

export async function exportOutlookEventById(args: {
  supabase: SupabaseClient;
  userId: string;
  eventId: string;
}): Promise<{ exported: number; error: string | null }> {
  const { data, error } = await args.supabase
    .from("calendar_events")
    .select(
      "id, title, description, starts_at, ends_at, all_day, location, external_id, connection_id, created_by, visibility, source"
    )
    .eq("id", args.eventId)
    .maybeSingle();
  if (error) return { exported: 0, error: error.message };
  if (!data) return { exported: 0, error: "Event not found." };
  const result = await exportEventToOutlook({
    supabase: args.supabase,
    userId: args.userId,
    event: data as OutlookExportEvent,
  });
  return { exported: result.exported, error: result.error };
}
