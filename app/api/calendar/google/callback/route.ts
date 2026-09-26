import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  exchangeGoogleCode,
  fetchGoogleUserEmail,
  googleOAuthConfigured,
} from "@/lib/google-calendar";
import {
  PENDING_COOKIE,
  PENDING_MAX_AGE,
  serializePendingCookie,
} from "@/lib/google-pending-cookie";
import { OAUTH_STATE_COOKIE, verifyOAuthState } from "@/lib/oauth-state";
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
      `${origin}/app/calendar?google_error=${encodeURIComponent(codeName)}`
    );
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (oauthError) return fail(oauthError);
  if (!code) return fail("missing_code");
  if (!googleOAuthConfigured()) return fail("not_configured");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      `${origin}/login?next=${encodeURIComponent("/app/calendar")}`
    );
  }

  const jar = await cookies();
  const stateCookie = jar.get(OAUTH_STATE_COOKIE)?.value;
  if (!verifyOAuthState(state, stateCookie, user.id)) {
    return fail("invalid_state");
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    const email = await fetchGoogleUserEmail(tokens.access_token);
    const pending = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
      scopes: tokens.scope ?? null,
      email,
    };
    const res = NextResponse.redirect(`${origin}/app/calendar?google_pick=1`);
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(PENDING_COOKIE, serializePendingCookie(pending), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: PENDING_MAX_AGE,
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "token_exchange_failed";
    return fail(msg.slice(0, 80));
  }
}
