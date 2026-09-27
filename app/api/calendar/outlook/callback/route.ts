import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  exchangeOutlookCode,
  fetchOutlookUserEmail,
  outlookOAuthConfigured,
  upgradeOutlookAccountTokens,
} from "@/lib/outlook-calendar";
import {
  OUTLOOK_PENDING_COOKIE,
  OUTLOOK_PENDING_MAX_AGE,
  serializeOutlookPendingCookie,
} from "@/lib/outlook-pending-cookie";
import {
  OUTLOOK_OAUTH_STATE_COOKIE,
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
      `${origin}/app/calendar?outlook_error=${encodeURIComponent(codeName)}`
    );
    res.cookies.set(OUTLOOK_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (oauthError) return fail(oauthError);
  if (!code) return fail("missing_code");
  if (!outlookOAuthConfigured()) return fail("not_configured");

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
  const stateCookie = jar.get(OUTLOOK_OAUTH_STATE_COOKIE)?.value;
  if (!verifyOAuthState(state, stateCookie, user.id)) {
    return fail("invalid_state");
  }

  try {
    const tokens = await exchangeOutlookCode(code);
    const email = await fetchOutlookUserEmail(tokens.access_token);
    const pending = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
      scopes: tokens.scope ?? null,
      email,
    };

    const { upgraded, hasWriteScope } = await upgradeOutlookAccountTokens({
      supabase,
      userId: user.id,
      pending,
    });

    const res =
      upgraded > 0 && hasWriteScope
        ? NextResponse.redirect(`${origin}/app/calendar?outlook_upgraded=1`)
        : NextResponse.redirect(`${origin}/app/calendar?outlook_pick=1`);

    res.cookies.set(OUTLOOK_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });

    if (upgraded > 0 && hasWriteScope) {
      res.cookies.set(OUTLOOK_PENDING_COOKIE, "", { path: "/", maxAge: 0 });
    } else {
      res.cookies.set(
        OUTLOOK_PENDING_COOKIE,
        serializeOutlookPendingCookie(pending),
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: OUTLOOK_PENDING_MAX_AGE,
        }
      );
    }

    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "token_exchange_failed";
    return fail(msg.slice(0, 80));
  }
}
