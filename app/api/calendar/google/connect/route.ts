import { NextResponse } from "next/server";
import {
  buildGoogleAuthUrl,
  googleOAuthConfigured,
} from "@/lib/google-calendar";
import { createOAuthState } from "@/lib/oauth-state";
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

  if (!googleOAuthConfigured()) {
    return NextResponse.redirect(
      `${origin}/app/calendar?google_error=not_configured`
    );
  }

  const { state, cookieValue, cookieName, maxAge } = createOAuthState(user.id);
  const url = buildGoogleAuthUrl(state);
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
