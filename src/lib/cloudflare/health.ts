import type { CheckResult, HealthStatus, Severity } from "@/lib/types";

export const REQUIRED_CHECKS = ["api_connection", "waf_rules", "redirect_rules", "robots_txt", "access_tests"] as const;
const STALE_AFTER_MS = 7 * 24 * 3600 * 1000;

export interface HealthInput {
  connected: boolean;
  lastAuditAt: string | null;
  checks: CheckResult[];
  openFindingSeverities: Severity[];
  now?: number;
}

/**
 * Overall zone status. "Healthy" requires every required check to have actually
 * completed in the last 7 days with no open findings above "low" — a successful
 * API connection alone never yields Healthy.
 */
export function computeHealth(input: HealthInput): { status: HealthStatus; reason: string } {
  const now = input.now ?? Date.now();
  if (!input.connected && !input.lastAuditAt) {
    return { status: "not_connected", reason: "No Cloudflare connection and no completed audit." };
  }
  const sev = new Set(input.openFindingSeverities);
  if (sev.has("critical")) return { status: "critical", reason: "Open critical findings require attention." };
  if (sev.has("high")) return { status: "warning", reason: "Open high-severity findings." };

  if (!input.lastAuditAt) return { status: "needs_review", reason: "No audit has been completed yet." };
  if (now - new Date(input.lastAuditAt).getTime() > STALE_AFTER_MS) {
    return { status: "needs_review", reason: "Last audit is older than 7 days." };
  }
  const byName = new Map(input.checks.map((c) => [c.check, c]));
  const incomplete = REQUIRED_CHECKS.filter((c) => byName.get(c)?.status !== "completed");
  if (incomplete.length) {
    return {
      status: input.connected ? "needs_review" : "not_connected",
      reason: `Checks not completed: ${incomplete.join(", ").replace(/_/g, " ")}.`,
    };
  }
  if (sev.has("medium")) return { status: "needs_review", reason: "Open medium-severity findings." };
  return { status: "healthy", reason: "All required checks completed with no significant open findings." };
}
