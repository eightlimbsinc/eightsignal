import type { RedirectHop } from "@/lib/security/safe-fetch";

export type AccessResult = "accessible" | "redirected" | "challenged" | "blocked" | "error" | "timeout";

const KEEP_HEADERS = [
  "server", "cf-ray", "cf-cache-status", "cf-mitigated", "content-type", "content-length", "location",
  "x-robots-tag", "cache-control", "retry-after", "strict-transport-security", "x-frame-options",
  "content-security-policy", "vary", "age", "last-modified",
];

/** Keeps only diagnostic headers (drops cookies and anything user-identifying). */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of KEEP_HEADERS) if (headers[h] !== undefined) out[h] = headers[h].slice(0, 500);
  return out;
}

/**
 * Detects a Cloudflare challenge. `cf-mitigated: challenge` is the documented
 * signal; the body markers are fallbacks for older challenge pages.
 */
export function detectChallenge(status: number, headers: Record<string, string>, body: string): boolean {
  if ((headers["cf-mitigated"] ?? "").toLowerCase().includes("challenge")) return true;
  if (status === 403 || status === 503 || status === 429) {
    const snippet = body.slice(0, 20_000);
    return /cdn-cgi\/challenge-platform|cf-chl-|Just a moment\.\.\.|Attention Required! \| Cloudflare|cf_chl_opt/i.test(snippet);
  }
  return false;
}

export function classifyAccess(params: {
  status: number;
  headers: Record<string, string>;
  body: string;
  redirectChain: RedirectHop[];
  requestedUrl: string;
  finalUrl: string;
}): { result: AccessResult; challenge: boolean } {
  const challenge = detectChallenge(params.status, params.headers, params.body);
  if (challenge) return { result: "challenged", challenge: true };
  if (params.status === 401 || params.status === 403 || params.status === 451 || params.status === 429) {
    return { result: "blocked", challenge: false };
  }
  if (params.status >= 500 || params.status === 0) return { result: "error", challenge: false };
  if (params.status >= 400) return { result: "error", challenge: false };
  if (params.redirectChain.length > 0) {
    const sameTarget = stripSlash(params.requestedUrl) === stripSlash(params.finalUrl);
    return { result: sameTarget ? "accessible" : "redirected", challenge: false };
  }
  return { result: "accessible", challenge: false };
}

function stripSlash(u: string) {
  return u.replace(/\/+$/, "");
}
