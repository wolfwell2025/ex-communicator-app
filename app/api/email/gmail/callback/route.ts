import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  exchangeGmailCode,
  fetchGoogleUserEmail,
  gmailOAuthConfigured,
  syncGmailConnection,
  upsertGmailConnection,
} from "@/lib/gmail";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  verifyOAuthState,
} from "@/lib/oauth-state";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const origin = getSiteUrl();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const fail = (codeName: string) => {
    const res = NextResponse.redirect(
      `${origin}/app/email?gmail_error=${encodeURIComponent(codeName)}`
    );
    res.cookies.set(GMAIL_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (oauthError) return fail(oauthError);
  if (!code) return fail("missing_code");
  if (!gmailOAuthConfigured()) return fail("not_configured");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      `${origin}/login?next=${encodeURIComponent("/app/email")}`
    );
  }

  const jar = await cookies();
  const stateCookie = jar.get(GMAIL_OAUTH_STATE_COOKIE)?.value;
  if (!verifyOAuthState(state, stateCookie, user.id)) {
    return fail("invalid_state");
  }

  try {
    const tokens = await exchangeGmailCode(code);
    const email = await fetchGoogleUserEmail(tokens.access_token);
    const { connectionId, error } = await upsertGmailConnection({
      supabase,
      userId: user.id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
      scopes: tokens.scope ?? null,
      email,
    });
    if (error || !connectionId) {
      return fail(error || "upsert_failed");
    }

    // Best-effort initial sync (do not fail connect if sync errors)
    await syncGmailConnection({
      supabase,
      userId: user.id,
      connectionId,
    });

    const res = NextResponse.redirect(`${origin}/app/email?gmail_connected=1`);
    res.cookies.set(GMAIL_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "token_exchange_failed";
    return fail(msg.slice(0, 80));
  }
}
