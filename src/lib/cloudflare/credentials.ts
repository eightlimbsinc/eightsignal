import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for Cloudflare API tokens at rest. The key comes from the
 * CLOUDFLARE_CREDENTIALS_KEY server environment variable (32 bytes, base64 or hex).
 */
export function parseKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("CLOUDFLARE_CREDENTIALS_KEY is not configured");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CLOUDFLARE_CREDENTIALS_KEY must decode to 32 bytes");
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 29) throw new Error("Malformed encrypted secret");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** Rejects things that are clearly not scoped API tokens (e.g. a Global API Key). */
export function validateTokenShape(token: string): string | null {
  const t = token.trim();
  if (!t) return "Token is required";
  if (/^[0-9a-f]{37}$/i.test(t)) {
    return "This looks like a Cloudflare Global API Key. EightSignal only accepts scoped API tokens.";
  }
  if (t.length < 30 || t.length > 200 || /\s/.test(t)) return "That does not look like a Cloudflare API token";
  return null;
}
