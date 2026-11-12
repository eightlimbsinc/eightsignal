/**
 * Read-only Cloudflare API client.
 *
 * Safety properties:
 *  - Only GET requests are issued against the REST API, plus POST to the GraphQL
 *    Analytics endpoint (which is a read-only query API). There is deliberately
 *    no code path that can create, modify, reorder or delete Cloudflare config.
 *  - Tokens are passed in per call and never logged or returned.
 *  - Permission failures are reported as "unavailable" capabilities rather than
 *    errors, so the UI can say "requires manual verification / more scopes".
 */

const API_BASE = "https://api.cloudflare.com/client/v4";
const TIMEOUT_MS = 15_000;

export type CfResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; reason: "forbidden" | "not_found" | "unauthorized" | "rate_limited" | "error"; message: string };

interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

type FetchLike = typeof fetch;

export class CloudflareReadOnlyClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async get<T>(path: string): Promise<CfResult<T>> {
    if (!path.startsWith("/")) throw new Error("Invalid Cloudflare API path");
    let res: Response;
    try {
      res = await this.fetchImpl(`${API_BASE}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      return { ok: false, status: 0, reason: "error", message: e instanceof Error ? e.message : "Network error" };
    }
    return this.unwrap<T>(res);
  }

  private async unwrap<T>(res: Response): Promise<CfResult<T>> {
    let body: CfEnvelope<T> | null = null;
    try {
      body = (await res.json()) as CfEnvelope<T>;
    } catch {
      body = null;
    }
    const message = body?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
    if (res.status === 401) return { ok: false, status: 401, reason: "unauthorized", message };
    if (res.status === 403) return { ok: false, status: 403, reason: "forbidden", message };
    if (res.status === 404) return { ok: false, status: 404, reason: "not_found", message };
    if (res.status === 429) return { ok: false, status: 429, reason: "rate_limited", message };
    if (!res.ok || !body?.success) return { ok: false, status: res.status, reason: "error", message };
    return { ok: true, data: body.result, status: res.status };
  }

  async verifyToken(accountId?: string | null): Promise<CfResult<{ id: string; status: string; expires_on?: string }>> {
    const user = await this.get<{ id: string; status: string; expires_on?: string }>("/user/tokens/verify");
    if (user.ok || !accountId) return user;
    // Account-owned tokens verify against the account endpoint instead.
    return this.get(`/accounts/${encodeURIComponent(accountId)}/tokens/verify`);
  }

  listZones(name?: string) {
    const q = new URLSearchParams({ per_page: "50" });
    if (name) q.set("name", name);
    return this.get<CfZone[]>(`/zones?${q}`);
  }

  getZone(zoneId: string) {
    return this.get<CfZone>(`/zones/${encodeURIComponent(zoneId)}`);
  }

  /** Phase entrypoint ruleset. 404 means no rules exist in that phase. */
  getPhaseEntrypoint(zoneId: string, phase: RulesetPhase) {
    return this.get<CfRuleset>(`/zones/${encodeURIComponent(zoneId)}/rulesets/phases/${phase}/entrypoint`);
  }

  getBotManagement(zoneId: string) {
    return this.get<Record<string, unknown>>(`/zones/${encodeURIComponent(zoneId)}/bot_management`);
  }

  getPageRules(zoneId: string) {
    return this.get<CfPageRule[]>(`/zones/${encodeURIComponent(zoneId)}/pagerules`);
  }

  getAuditLogs(accountId: string, sinceIso: string) {
    const q = new URLSearchParams({ since: sinceIso, per_page: "100", direction: "desc" });
    return this.get<CfAuditLog[]>(`/accounts/${encodeURIComponent(accountId)}/audit_logs?${q}`);
  }

  /**
   * Firewall/security events via the GraphQL Analytics API (read-only). Requires
   * the "Analytics Read" zone permission; availability and retention depend on plan.
   */
  async getSecurityEvents(zoneId: string, sinceIso: string): Promise<CfResult<CfSecurityEvent[]>> {
    const query = `query SecurityEvents($zoneTag: string, $since: Time) {
      viewer { zones(filter: { zoneTag: $zoneTag }) {
        firewallEventsAdaptive(limit: 500, filter: { datetime_geq: $since }, orderBy: [datetime_DESC]) {
          action source ruleId clientRequestPath userAgent datetime
        }
      } }
    }`;
    let res: Response;
    try {
      res = await this.fetchImpl(`${API_BASE}/graphql`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { zoneTag: zoneId, since: sinceIso } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      return { ok: false, status: 0, reason: "error", message: e instanceof Error ? e.message : "Network error" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, reason: res.status === 401 ? "unauthorized" : "forbidden", message: `HTTP ${res.status}` };
    }
    const body = (await res.json().catch(() => null)) as
      | { data?: { viewer?: { zones?: { firewallEventsAdaptive?: CfSecurityEvent[] }[] } }; errors?: { message: string }[] | null }
      | null;
    if (!body || (body.errors && body.errors.length)) {
      const message = body?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
      const forbidden = /not authorized|permission|access/i.test(message);
      return { ok: false, status: res.status, reason: forbidden ? "forbidden" : "error", message };
    }
    return { ok: true, status: res.status, data: body.data?.viewer?.zones?.[0]?.firewallEventsAdaptive ?? [] };
  }
}

export type RulesetPhase =
  | "http_request_firewall_custom"
  | "http_request_dynamic_redirect"
  | "http_ratelimit"
  | "http_request_firewall_managed";

export interface CfZone {
  id: string;
  name: string;
  status: string;
  plan?: { name?: string };
  account?: { id: string; name: string };
}

export interface CfRule {
  id: string;
  version?: string;
  action: string;
  expression: string;
  description?: string;
  enabled: boolean;
  last_updated?: string;
  ref?: string;
  action_parameters?: Record<string, unknown>;
}

export interface CfRuleset {
  id: string;
  name?: string;
  phase: string;
  version?: string;
  last_updated?: string;
  rules?: CfRule[];
}

export interface CfPageRule {
  id: string;
  status: string;
  priority: number;
  targets: { target: string; constraint: { operator: string; value: string } }[];
  actions: { id: string; value?: unknown }[];
  modified_on?: string;
}

export interface CfAuditLog {
  id: string;
  action?: { type?: string; result?: boolean };
  actor?: { email?: string; type?: string };
  resource?: { type?: string; id?: string };
  when?: string;
  metadata?: Record<string, unknown>;
}

export interface CfSecurityEvent {
  action: string;
  source: string;
  ruleId: string;
  clientRequestPath: string;
  userAgent: string;
  datetime: string;
}
