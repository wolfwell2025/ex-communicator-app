import { NextResponse } from "next/server";
import {
  buildOutlookAuthUrl,
  outlookOAuthConfigured,
} from "@/lib/outlook-calendar";
import {
  createOAuthState,
  OUTLOOK_OAUTH_STATE_COOKIE,
} from "@/lib/oauth-state";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const origin = getSiteUrl();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      `${origin}/login?next=${encodeURIComponent("/app/calendar")}`
    );
  }

  if (!outlookOAuthConfigured()) {
    return NextResponse.redirect(
      `${origin}/app/calendar?outlook_error=not_configured`
    );
  }

  const { state, cookieValue, cookieName, maxAge } = createOAuthState(
    user.id,
    OUTLOOK_OAUTH_STATE_COOKIE
  );
  const url = buildOutlookAuthUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return res;
}
