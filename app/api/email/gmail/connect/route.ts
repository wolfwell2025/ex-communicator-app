import { NextResponse } from "next/server";
import { buildGmailAuthUrl, gmailOAuthConfigured } from "@/lib/gmail";
import {
  createOAuthState,
  GMAIL_OAUTH_STATE_COOKIE,
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
      `${origin}/login?next=${encodeURIComponent("/app/email")}`
    );
  }

  if (!gmailOAuthConfigured()) {
    return NextResponse.redirect(
      `${origin}/app/email?gmail_error=not_configured`
    );
  }

  const { state, cookieValue, cookieName, maxAge } = createOAuthState(
    user.id,
    GMAIL_OAUTH_STATE_COOKIE
  );
  const url = buildGmailAuthUrl(state);
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
