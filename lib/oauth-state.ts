import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const COOKIE_NAME = "gcal_oauth_state";
const MAX_AGE_SEC = 600;

function signingKey(): string {
  return (
    process.env.CALENDAR_TOKEN_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    "dev-insecure-oauth-state"
  );
}

export function createOAuthState(userId: string): {
  state: string;
  cookieValue: string;
  cookieName: string;
  maxAge: number;
} {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${userId}.${nonce}.${Date.now()}`;
  const sig = createHmac("sha256", signingKey())
    .update(payload)
    .digest("base64url");
  const state = `${payload}.${sig}`;
  return {
    state,
    cookieValue: state,
    cookieName: COOKIE_NAME,
    maxAge: MAX_AGE_SEC,
  };
}

export function verifyOAuthState(
  state: string | null,
  cookieValue: string | undefined,
  userId: string
): boolean {
  if (!state || !cookieValue || state !== cookieValue) return false;
  const parts = state.split(".");
  if (parts.length !== 4) return false;
  const [uid, , tsStr, sig] = parts;
  if (uid !== userId) return false;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Date.now() - ts > MAX_AGE_SEC * 1000) {
    return false;
  }
  const payload = parts.slice(0, 3).join(".");
  const expected = createHmac("sha256", signingKey())
    .update(payload)
    .digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export { COOKIE_NAME as OAUTH_STATE_COOKIE };
