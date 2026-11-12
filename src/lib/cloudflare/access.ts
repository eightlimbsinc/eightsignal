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

export interface AccessOutcome {
  urlId: string;
  url: string;
  identity: string; // crawler key or "browser"
  name: string;
  identityClass?: "search" | "user_directed" | "browser_agent" | "training";
  result: AccessResult;
  status: number | null;
}

export interface AccessFindingDraft {
  key: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  recommendation: string;
  evidence: Record<string, unknown>;
  identities: string[];
}

const SERVER_NOTE =
  "EightSignal's tests run from a cloud data-centre (Netlify). Cloudflare commonly challenges data-centre traffic that real visitors on home or office connections never see, so this needs manual confirmation from a normal browser.";

/**
 * Turns raw access-test outcomes into findings, calibrated for the fact that the
 * tests run from a data-centre with simulated user-agents:
 *  - A Cloudflare challenge to the baseline browser is usually data-centre IP
 *    scoring, not an outage → medium, "verify manually".
 *  - 5xx / timeouts for the baseline browser indicate the site itself is failing → critical / high.
 *  - A crawler UA being blocked is often Cloudflare correctly rejecting a SPOOFED
 *    crawler (not from the provider's IPs) → low, never high, unless a WAF rule or
 *    security events confirm it (those are separate, API-based findings).
 *  - When the baseline itself is challenged/blocked, crawler comparisons are meaningless and skipped.
 */
export function assessAccessOutcomes(results: AccessOutcome[]): AccessFindingDraft[] {
  const findings: AccessFindingDraft[] = [];
  const denied = new Set<AccessResult>(["blocked", "challenged"]);
  for (const r of results) {
    if (r.identity === "browser") {
      if (r.result === "error" && r.status !== null && r.status >= 500) {
        findings.push({
          key: `access:baseline:${r.urlId}`, type: "access_page_error", severity: "critical",
          title: `${r.url} returned HTTP ${r.status}`,
          description: `The server answered with an error (${r.status}). This is not a bot-protection response; visitors are likely affected.`,
          recommendation: "Load the page manually now and check the origin/hosting status.",
          evidence: { url: r.url, status: r.status, result: r.result }, identities: [],
        });
      } else if (r.result === "error" || r.result === "timeout") {
        findings.push({
          key: `access:baseline:${r.urlId}`, type: "access_page_unreachable", severity: "high",
          title: `${r.url} could not be loaded by EightSignal (${r.result}${r.status ? `, HTTP ${r.status}` : ""})`,
          description: `The request failed or timed out. ${SERVER_NOTE}`,
          recommendation: "Open the page in a normal browser. If it loads, re-run the test later; if not, escalate.",
          evidence: { url: r.url, status: r.status, result: r.result }, identities: [],
        });
      } else if (denied.has(r.result)) {
        findings.push({
          key: `access:baseline:${r.urlId}`, type: "access_server_challenged", severity: "medium",
          title: `Cloudflare ${r.result} EightSignal's server-side check of ${r.url}`,
          description: `${SERVER_NOTE} Real visitors are probably NOT affected, but it also means crawler comparisons for this URL can't be judged from here.`,
          recommendation: "Open the URL in a normal browser (and a private window) to confirm it loads without a challenge. If it does, mark this finding as false positive or accepted risk.",
          evidence: { url: r.url, status: r.status, result: r.result, test_origin: "data-centre" }, identities: [],
        });
      }
      continue;
    }
    const baseline = results.find((b) => b.urlId === r.urlId && b.identity === "browser");
    if (!baseline || baseline.result !== "accessible" && baseline.result !== "redirected") continue;
    if (!denied.has(r.result)) continue;
    findings.push({
      key: `access:identity:${r.identity}:${r.urlId}`, type: "access_simulated_identity_denied",
      severity: r.identityClass === "training" ? "info" : "low",
      title: `Simulated ${r.name} request to ${r.url} was ${r.result}`,
      description: `A request sending ${r.name}'s user-agent was ${r.result} (HTTP ${r.status ?? "—"}) while a normal browser was allowed. This is often Cloudflare correctly rejecting a SPOOFED ${r.name} — the request did not come from ${r.name}'s real IP addresses. It only matters if a WAF rule or bot setting also blocks the genuine crawler; the WAF audit and Security Events checks (Cloudflare token required) confirm that.`,
      recommendation: `Treat as informational until the WAF audit or Security Events show genuine ${r.name} traffic being blocked.`,
      evidence: { url: r.url, status: r.status, result: r.result, test_type: "simulated_user_agent" },
      identities: [r.identity],
    });
  }
  return findings;
}
