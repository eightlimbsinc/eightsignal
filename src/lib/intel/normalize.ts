import { createHash } from "node:crypto";

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref|ref_src|_hsenc|_hsmi|mkt_tok|igshid|yclid)$/i;

/**
 * Canonicalises a URL for duplicate detection: lower-cases scheme/host, drops
 * default ports, fragments, tracking parameters and trailing slashes, and sorts
 * the remaining query parameters.
 */
export function canonicalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of params) url.searchParams.append(k, v);
  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  url.pathname = path;
  // Treat http/https variants as the same resource.
  url.protocol = "https:";
  return url.toString();
}

export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Content fingerprint: SHA-256 over the normalised title plus the first 2,000
 * characters of normalised body text. Identical announcements syndicated under
 * different URLs therefore collide, while edits to substance do not.
 */
export function contentFingerprint(title: string, content: string | null | undefined): string {
  const basis = `${normalizeText(title)}\n${normalizeText(content ?? "").slice(0, 2000)}`;
  return createHash("sha256").update(basis).digest("hex");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
