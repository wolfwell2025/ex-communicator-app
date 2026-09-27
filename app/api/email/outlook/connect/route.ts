import { NextResponse } from "next/server";
import {
  createOAuthState,
  OUTLOOK_MAIL_OAUTH_STATE_COOKIE,
} from "@/lib/oauth-state";
import {
  buildOutlookMailAuthUrl,
  outlookMailOAuthConfigured,
} from "@/lib/outlook-mail";
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
      `${origin}/login?next=${encodeURIComponent("/app/email")}`
    );
  }

  if (!outlookMailOAuthConfigured()) {
    return NextResponse.redirect(
      `${origin}/app/email?outlook_error=not_configured`
    );
  }

  const { state, cookieValue, cookieName, maxAge } = createOAuthState(
    user.id,
    OUTLOOK_MAIL_OAUTH_STATE_COOKIE
  );
  const url = buildOutlookMailAuthUrl(state);
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
