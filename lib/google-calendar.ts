import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "./crypto-tokens";
import { getSiteUrl } from "./supabase/env";

/**
 * HARD PRIVACY RULE:
 * Google sync ALWAYS imports as visibility=private + source=google.
 * Co-parent never sees imported events until the owner explicitly proposes
 * and the co-parent accepts in-app. Never auto-share on connect/sync.
 */

export {
  GOOGLE_CALENDAR_SCOPES,
  connectionHasWriteScope,
} from "./google-calendar-scopes";
import { GOOGLE_CALENDAR_SCOPES, connectionHasWriteScope } from "./google-calendar-scopes";

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
};

export type PendingGoogleAuth = {
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

export function googleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export function getGoogleRedirectUri(): string {
  const override = process.env.GOOGLE_REDIRECT_URI?.trim().replace(/\/$/, "");
  if (override) return override;
  return `${getSiteUrl()}/api/calendar/google/callback`;
}

export function buildGoogleAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new Error("Missing GOOGLE_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES,
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(
  code: string
): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getGoogleRedirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as GoogleTokenResponse & { error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error || `Token exchange failed (${res.status})`);
  }
  return json;
}

export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<GoogleTokenResponse> {
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
  const json = (await res.json()) as GoogleTokenResponse & { error?: string };
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

export async function listGoogleCalendars(
  accessToken: string
): Promise<GoogleCalendarListEntry[]> {
  const calendars: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ minAccessRole: "reader" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const json = (await res.json()) as {
      items?: GoogleCalendarListEntry[];
      nextPageToken?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(
        json.error?.message || `Calendar list failed (${res.status})`
      );
    }
    for (const item of json.items ?? []) {
      if (!item.id) continue;
      calendars.push({
        id: item.id,
        summary: item.summary || item.id,
        description: item.description,
        primary: item.primary,
        accessRole: item.accessRole,
        backgroundColor: item.backgroundColor,
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  calendars.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return a.summary.localeCompare(b.summary);
  });
  return calendars;
}

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

async function listUpcomingGoogleEvents(
  accessToken: string,
  calendarId: string,
  options?: { daysAhead?: number; maxResults?: number }
): Promise<GoogleEvent[]> {
  const daysAhead = options?.daysAhead ?? 90;
  const maxResults = options?.maxResults ?? 100;
  const timeMin = new Date().toISOString();
  const timeMax = new Date(
    Date.now() + daysAhead * 24 * 60 * 60 * 1000
  ).toISOString();
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  const encodedId = encodeURIComponent(calendarId);

  do {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin,
      timeMax,
      maxResults: String(Math.min(50, maxResults - events.length)),
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodedId}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const json = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(
        json.error?.message || `Events list failed (${res.status})`
      );
    }
    for (const item of json.items ?? []) {
      if (item.status === "cancelled") continue;
      events.push(item);
      if (events.length >= maxResults) break;
    }
    pageToken = json.nextPageToken;
  } while (pageToken && events.length < maxResults);

  return events;
}

function googleEventToRow(event: GoogleEvent): {
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
} | null {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  if (!start || !end) return null;

  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  let starts_at: string;
  let ends_at: string;

  if (allDay) {
    const startDate = event.start!.date!;
    const endExclusive = event.end!.date!;
    starts_at = new Date(`${startDate}T00:00:00`).toISOString();
    const endInclusive = new Date(`${endExclusive}T00:00:00`);
    endInclusive.setMilliseconds(endInclusive.getMilliseconds() - 1);
    ends_at = endInclusive.toISOString();
    if (ends_at < starts_at) {
      ends_at = new Date(`${startDate}T23:59:59`).toISOString();
    }
  } else {
    starts_at = new Date(start).toISOString();
    ends_at = new Date(end).toISOString();
  }

  if (ends_at < starts_at) return null;
  const title = (event.summary || "(No title)").trim().slice(0, 200);
  if (!title) return null;

  return {
    title,
    description: event.description?.trim().slice(0, 5000) || null,
    starts_at,
    ends_at,
    all_day: allDay,
    location: event.location?.trim().slice(0, 300) || null,
  };
}

async function getValidAccessToken(
  supabase: SupabaseClient,
  connection: ConnectionSecrets
): Promise<string> {
  if (!connection.access_token_enc) {
    throw new Error("No access token stored. Reconnect Google Calendar.");
  }
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;
  if (expiresAt > Date.now() + 60_000) {
    return decryptSecret(connection.access_token_enc);
  }
  if (!connection.refresh_token_enc) {
    throw new Error("Google access expired and no refresh token. Reconnect.");
  }
  const refreshToken = decryptSecret(connection.refresh_token_enc);
  const refreshed = await refreshGoogleAccessToken(refreshToken);
  const accessEnc = encryptSecret(refreshed.access_token);
  const expires = new Date(
    Date.now() + (refreshed.expires_in || 3600) * 1000
  ).toISOString();

  // Refresh tokens on ALL rows that share this refresh token (same Google account)
  await supabase
    .from("personal_calendar_connections")
    .update({
      access_token_enc: accessEnc,
      token_expires_at: expires,
      scopes: refreshed.scope ?? connection.scopes,
    })
    .eq("user_id", connection.user_id)
    .eq("provider", "google")
    .eq("refresh_token_enc", connection.refresh_token_enc);

  return refreshed.access_token;
}

export function encodePendingAuth(pending: PendingGoogleAuth): string {
  return encryptSecret(JSON.stringify(pending));
}

export function decodePendingAuth(payload: string): PendingGoogleAuth {
  return JSON.parse(decryptSecret(payload)) as PendingGoogleAuth;
}

/** Create or update one calendar connection. Sync imports stay private. */
export async function saveCalendarConnection(args: {
  supabase: SupabaseClient;
  userId: string;
  pending: PendingGoogleAuth;
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
    (args.label?.trim() || args.calendarSummary || "Google calendar").slice(
      0,
      120
    );

  // Reuse refresh token from an existing row for this account if Google omitted it
  let refreshToStore = refreshEnc;
  if (!refreshToStore && args.pending.email) {
    const { data: sibling } = await args.supabase
      .from("personal_calendar_connections")
      .select("refresh_token_enc")
      .eq("user_id", args.userId)
      .eq("provider", "google")
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
    .eq("provider", "google")
    .eq("external_account_email", args.pending.email)
    .eq("external_calendar_id", args.calendarId)
    .maybeSingle();

  const payload = {
    user_id: args.userId,
    provider: "google" as const,
    status: "connected" as const,
    label,
    sync_enabled: args.syncEnabled ?? true,
    external_account_email: args.pending.email,
    external_calendar_id: args.calendarId,
    access_token_enc: accessEnc,
    refresh_token_enc: refreshToStore,
    token_expires_at: expires,
    scopes: args.pending.scopes ?? GOOGLE_CALENDAR_SCOPES,
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
 * Import upcoming events as PRIVATE only (source=google).
 * Never sets visibility to pending/shared. Co-parent cannot see these
 * until the owner proposes and they accept in-app.
 */
export async function syncGoogleCalendarEvents(args: {
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
    return { imported: 0, error: null }; // paused — not an error
  }
  if (!conn.external_calendar_id) {
    return { imported: 0, error: "No Google calendar id on connection." };
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

  let googleEvents: GoogleEvent[];
  try {
    googleEvents = await listUpcomingGoogleEvents(
      accessToken,
      connection.external_calendar_id!
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Calendar fetch failed";
    return { imported: 0, error: msg };
  }

  let imported = 0;
  for (const ge of googleEvents) {
    const mapped = googleEventToRow(ge);
    if (!mapped) continue;

    // HARD RULE: always private — never auto-share to household / co-parent
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
      source: "google" as const,
      external_id: ge.id,
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
      .eq("external_id", ge.id)
      .maybeSingle();

    if (existing?.id) {
      // Update content only — NEVER change visibility (user may have proposed/shared)
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

export async function syncAllEnabledGoogleCalendars(args: {
  supabase: SupabaseClient;
  userId: string;
  householdId: string;
}): Promise<{ imported: number; errors: string[] }> {
  const { data: conns } = await args.supabase
    .from("personal_calendar_connections")
    .select("id")
    .eq("user_id", args.userId)
    .eq("provider", "google")
    .eq("status", "connected")
    .eq("sync_enabled", true);

  let imported = 0;
  const errors: string[] = [];
  for (const c of conns ?? []) {
    const result = await syncGoogleCalendarEvents({
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

export async function setConnectionSyncEnabled(args: {
  supabase: SupabaseClient;
  userId: string;
  connectionId: string;
  syncEnabled: boolean;
}): Promise<{ error: string | null }> {
  const { error } = await args.supabase
    .from("personal_calendar_connections")
    .update({ sync_enabled: args.syncEnabled })
    .eq("id", args.connectionId)
    .eq("user_id", args.userId);
  return { error: error?.message ?? null };
}

export async function updateConnectionLabel(args: {
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
    .eq("user_id", args.userId);
  return { error: error?.message ?? null };
}

export async function disconnectCalendarConnection(args: {
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
    .maybeSingle();

  if (!conn) return { error: null };

  if (args.removeImportedEvents) {
    await args.supabase
      .from("calendar_events")
      .delete()
      .eq("connection_id", conn.id)
      .eq("created_by", args.userId)
      .eq("source", "google");
  }

  const { error } = await args.supabase
    .from("personal_calendar_connections")
    .delete()
    .eq("id", conn.id)
    .eq("user_id", args.userId);

  return { error: error?.message ?? null };
}

/** Load pending auth from an existing connected row (add another calendar, same account). */
export async function pendingFromConnection(
  supabase: SupabaseClient,
  userId: string,
  connectionId: string
): Promise<{ pending: PendingGoogleAuth | null; error: string | null }> {
  const { data: conn, error } = await supabase
    .from("personal_calendar_connections")
    .select(
      "id, user_id, external_calendar_id, sync_enabled, status, access_token_enc, refresh_token_enc, token_expires_at, scopes, external_account_email"
    )
    .eq("id", connectionId)
    .eq("user_id", userId)
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

/** Payload for creating/updating a Google Calendar event from an in-app row. */
export type GoogleExportEvent = {
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

function toGoogleEventBody(event: GoogleExportEvent): Record<string, unknown> {
  const summary = event.title.slice(0, 200);
  const description = event.description?.slice(0, 5000) || undefined;
  const location = event.location?.slice(0, 300) || undefined;

  if (event.all_day) {
    const startDay = event.starts_at.slice(0, 10);
    // Google all-day end is exclusive; add one day
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
      summary,
      description,
      location,
      start: { date: startDay },
      end: { date: endDay },
    };
  }

  return {
    summary,
    description,
    location,
    start: { dateTime: new Date(event.starts_at).toISOString() },
    end: { dateTime: new Date(event.ends_at).toISOString() },
  };
}

async function googleUpsertEvent(
  accessToken: string,
  calendarId: string,
  event: GoogleExportEvent,
  existingGoogleId: string | null
): Promise<string> {
  const encodedCal = encodeURIComponent(calendarId);
  const body = toGoogleEventBody(event);

  if (existingGoogleId) {
    const encodedEv = encodeURIComponent(existingGoogleId);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodedCal}/events/${encodedEv}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    const json = (await res.json()) as { id?: string; error?: { message?: string } };
    if (res.ok && json.id) return json.id;
    // Fall through to create if event was deleted on Google
    if (res.status !== 404) {
      throw new Error(json.error?.message || `Google update failed (${res.status})`);
    }
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodedCal}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const json = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message || `Google create failed (${res.status})`);
  }
  return json.id;
}

async function googleDeleteEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string
): Promise<void> {
  const encodedCal = encodeURIComponent(calendarId);
  const encodedEv = encodeURIComponent(googleEventId);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodedCal}/events/${encodedEv}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(json.error?.message || `Google delete failed (${res.status})`);
  }
}

/**
 * Push an app-owned event to the user's export-enabled Google calendars.
 * MVP: only events where created_by = user and visibility in private|pending|shared.
 * Never pushes another person's private events. source=google imports are skipped
 * (they already live on Google).
 */
export async function exportEventToGoogle(args: {
  supabase: SupabaseClient;
  userId: string;
  event: GoogleExportEvent;
}): Promise<{ exported: number; googleEventId: string | null; error: string | null }> {
  if (args.event.created_by !== args.userId) {
    return { exported: 0, googleEventId: null, error: null };
  }
  if (!["private", "pending", "shared"].includes(args.event.visibility)) {
    return { exported: 0, googleEventId: null, error: null };
  }
  // Do not re-push pure Google imports (would duplicate)
  if (args.event.source === "google") {
    return { exported: 0, googleEventId: null, error: null };
  }

  const { data: conns, error: connErr } = await args.supabase
    .from("personal_calendar_connections")
    .select(
      "id, user_id, external_calendar_id, sync_enabled, export_enabled, status, access_token_enc, refresh_token_enc, token_expires_at, scopes"
    )
    .eq("user_id", args.userId)
    .eq("provider", "google")
    .eq("status", "connected")
    .eq("export_enabled", true);

  if (connErr) return { exported: 0, googleEventId: null, error: connErr.message };
  if (!conns?.length) {
    return { exported: 0, googleEventId: null, error: null };
  }

  let exported = 0;
  let primaryGoogleId: string | null = args.event.external_id;
  let primaryConnectionId: string | null = args.event.connection_id;
  const errors: string[] = [];

  for (const raw of conns) {
    const conn = raw as ConnectionSecrets & { export_enabled?: boolean };
    if (!conn.external_calendar_id) continue;
    if (!connectionHasWriteScope(conn.scopes)) {
      errors.push("Reconnect Google for two-way sync (write scope missing).");
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
      const googleId = await googleUpsertEvent(
        accessToken,
        conn.external_calendar_id,
        args.event,
        existingId
      );
      exported += 1;
      // Prefer storing link on first successful export connection
      if (!primaryConnectionId || primaryConnectionId === conn.id) {
        primaryGoogleId = googleId;
        primaryConnectionId = conn.id;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Export failed");
    }
  }

  if (
    exported > 0 &&
    primaryGoogleId &&
    primaryConnectionId &&
    (primaryGoogleId !== args.event.external_id ||
      primaryConnectionId !== args.event.connection_id)
  ) {
    await args.supabase
      .from("calendar_events")
      .update({
        external_id: primaryGoogleId,
        connection_id: primaryConnectionId,
        // keep source=manual for app-originated
      })
      .eq("id", args.event.id)
      .eq("created_by", args.userId);
  }

  return {
    exported,
    googleEventId: primaryGoogleId,
    error: exported === 0 && errors.length ? errors[0] : null,
  };
}

export async function deleteExportedGoogleEvent(args: {
  supabase: SupabaseClient;
  userId: string;
  event: Pick<
    GoogleExportEvent,
    "external_id" | "connection_id" | "created_by" | "source"
  >;
}): Promise<{ error: string | null }> {
  if (args.event.created_by !== args.userId) return { error: null };
  if (args.event.source === "google") return { error: null };
  if (!args.event.external_id || !args.event.connection_id) return { error: null };

  const { data: conn } = await args.supabase
    .from("personal_calendar_connections")
    .select(
      "id, user_id, external_calendar_id, sync_enabled, export_enabled, status, access_token_enc, refresh_token_enc, token_expires_at, scopes"
    )
    .eq("id", args.event.connection_id)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (!conn?.external_calendar_id) return { error: null };
  if (!(conn as { export_enabled?: boolean }).export_enabled) return { error: null };
  if (!connectionHasWriteScope(conn.scopes)) {
    return { error: "Reconnect Google for two-way sync (write scope missing)." };
  }

  try {
    const accessToken = await getValidAccessToken(
      args.supabase,
      conn as ConnectionSecrets
    );
    await googleDeleteEvent(
      accessToken,
      conn.external_calendar_id,
      args.event.external_id
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Google delete failed" };
  }
  return { error: null };
}

export async function setConnectionExportEnabled(args: {
  supabase: SupabaseClient;
  userId: string;
  connectionId: string;
  exportEnabled: boolean;
}): Promise<{ error: string | null }> {
  const { error } = await args.supabase
    .from("personal_calendar_connections")
    .update({ export_enabled: args.exportEnabled })
    .eq("id", args.connectionId)
    .eq("user_id", args.userId);
  return { error: error?.message ?? null };
}

/**
 * Load event by id and push to Google if export is enabled.
 */
export async function exportEventById(args: {
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
  const result = await exportEventToGoogle({
    supabase: args.supabase,
    userId: args.userId,
    event: data as GoogleExportEvent,
  });
  return { exported: result.exported, error: result.error };
}
