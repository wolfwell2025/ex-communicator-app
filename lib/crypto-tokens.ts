import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

/**
 * Encrypt short secrets (OAuth tokens) for DB storage.
 * Key material: CALENDAR_TOKEN_SECRET, else GOOGLE_CLIENT_SECRET.
 * Format: v1:<iv_b64>:<tag_b64>:<cipher_b64>
 */

function getKeyMaterial(): Buffer {
  const secret =
    process.env.CALENDAR_TOKEN_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "Missing CALENDAR_TOKEN_SECRET (or GOOGLE_CLIENT_SECRET) for token encryption"
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = getKeyMaterial();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const key = getKeyMaterial();
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted token format");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

export function canEncryptTokens(): boolean {
  return Boolean(
    process.env.CALENDAR_TOKEN_SECRET?.trim() ||
      process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}
