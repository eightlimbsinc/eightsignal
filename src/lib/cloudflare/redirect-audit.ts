import type { CfPageRule, CfRule } from "./api";
import { identitiesMentioned } from "./crawlers";
import type { DraftFinding } from "./findings";

const VERIFICATION_TERMS = ["captcha", "verify", "verification", "challenge", "login", "signin", "sign-in", "cdn-cgi/challenge", "human", "robot-check", "access-denied"];

export interface NormalizedRedirect {
  id: string;
  source: "single_redirect" | "page_rule";
  name: string;
  enabled: boolean;
  expression: string;          // match condition as text
  sourcePaths: string[];       // literal paths extracted from the condition (best effort)
  targetUrl: string | null;    // static target
  targetExpression: string | null; // dynamic target
  statusCode: number | null;
  position: number;
}

function literalPaths(expression: string): string[] {
  const out = new Set<string>();
  for (const m of expression.matchAll(/http\.request\.uri\.path\s+(?:eq|==)\s+"([^"]+)"/g)) out.add(m[1]);
  for (const m of expression.matchAll(/http\.request\.uri\.path\s+in\s+\{([^}]+)\}/g)) {
    for (const p of m[1].matchAll(/"([^"]+)"/g)) out.add(p[1]);
  }
  for (const m of expression.matchAll(/http\.request\.full_uri\s+(?:eq|==)\s+"([^"]+)"/g)) {
    try {
      out.add(new URL(m[1]).pathname);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

export function normalizeSingleRedirects(rules: CfRule[]): NormalizedRedirect[] {
  return rules
    .filter((r) => r.action === "redirect")
    .map((r, i) => {
      const params = (r.action_parameters ?? {}) as {
        from_value?: { status_code?: number; target_url?: { value?: string; expression?: string } };
      };
      return {
        id: r.id,
        source: "single_redirect" as const,
        name: r.description?.trim() || `Redirect rule #${i + 1}`,
        enabled: r.enabled,
        expression: r.expression ?? "",
        sourcePaths: literalPaths(r.expression ?? ""),
        targetUrl: params.from_value?.target_url?.value ?? null,
        targetExpression: params.from_value?.target_url?.expression ?? null,
        statusCode: params.from_value?.status_code ?? null,
        position: i + 1,
      };
    });
}

export function normalizePageRuleRedirects(pageRules: CfPageRule[]): NormalizedRedirect[] {
  return pageRules
    .filter((p) => p.actions.some((a) => a.id === "forwarding_url"))
    .map((p) => {
      const fwd = p.actions.find((a) => a.id === "forwarding_url")?.value as { url?: string; status_code?: number } | undefined;
      const target = p.targets[0]?.constraint.value ?? "";
      let path = "";
      try {
        path = new URL(target.startsWith("http") ? target : `https://${target}`).pathname;
      } catch {
        path = "";
      }
      return {
        id: p.id,
        source: "page_rule" as const,
        name: `Page Rule: ${target}`,
        enabled: p.status === "active",
        expression: target,
        sourcePaths: path && !path.includes("*") ? [path] : [],
        targetUrl: fwd?.url ?? null,
        targetExpression: null,
        statusCode: fwd?.status_code ?? null,
        position: p.priority,
      };
    });
}

function hostOf(url: string, fallback: string): string | null {
  try {
    return new URL(url, `https://${fallback}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function pathOf(url: string, domain: string): string | null {
  try {
    return new URL(url, `https://${domain}`).pathname;
  } catch {
    return null;
  }
}

function belongsToZone(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Reviews redirect configuration for loops, chains, cloaking and risky destinations. */
export function auditRedirects(redirects: NormalizedRedirect[], domain: string): DraftFinding[] {
  const findings: DraftFinding[] = [];
  const active = redirects.filter((r) => r.enabled);

  for (const r of active) {
    const evidence = {
      rule_id: r.id, rule_name: r.name, source: r.source, position: r.position,
      expression: r.expression, target_url: r.targetUrl, target_expression: r.targetExpression,
      status_code: r.statusCode,
    };
    const exprLower = r.expression.toLowerCase();
    const targetText = (r.targetUrl ?? r.targetExpression ?? "").toLowerCase();

    // Bot-specific redirect (possible cloaking or crawler diversion).
    if (/http\.user_agent|cf\.client\.bot|cf\.verified_bot_category|cf\.bot_management/.test(exprLower)) {
      const named = identitiesMentioned(exprLower);
      findings.push({
        key: `redirect:bot-specific:${r.id}`,
        type: "redirect_bot_specific",
        severity: "high",
        title: `${r.name} redirects based on bot / user-agent`,
        description: "This redirect only applies to certain user-agents or bots. Serving crawlers a different destination than users can be treated as cloaking by search engines, and can silently send AI agents to the wrong page. Bot-conditional redirects were also observed in previous unauthorized changes, so confirm who created it.",
        recommendation: "Verify the business reason and the author of this rule. If it is not documented and approved, escalate as a potential unauthorized change.",
        evidence: { ...evidence, matched_identities: named.map((n) => n.key) },
        identities: named.map((n) => n.key),
      });
    }

    // Redirects to verification / login / challenge pages.
    const verification = VERIFICATION_TERMS.filter((t) => targetText.includes(t));
    if (verification.length) {
      findings.push({
        key: `redirect:verification:${r.id}`,
        type: "redirect_to_verification",
        severity: "high",
        title: `${r.name} sends visitors to a verification-style page`,
        description: `The destination contains ${verification.map((v) => `"${v}"`).join(", ")}. Redirecting real content to verification or login pages blocks crawlers and agents and can be a sign of tampering.`,
        recommendation: "Confirm the destination is legitimate and intended. Use Cloudflare challenges rather than redirects for bot mitigation.",
        evidence: { ...evidence, terms: verification },
        identities: [],
      });
    }

    // External destinations.
    if (r.targetUrl) {
      const host = hostOf(r.targetUrl, domain);
      if (host && !belongsToZone(host, domain)) {
        findings.push({
          key: `redirect:external:${r.id}`,
          type: "redirect_external_destination",
          severity: "medium",
          title: `${r.name} redirects to an external domain (${host})`,
          description: `Requests are sent off ${domain} to ${host}. External redirects are sometimes legitimate (e.g. a careers platform) but are also a common pattern in compromised configurations.`,
          recommendation: `Confirm ${host} is an approved destination and record the approval in the client notes.`,
          evidence: { ...evidence, destination_host: host },
          identities: [],
        });
      }
    } else if (r.targetExpression && /http\.request\.(uri\.query|headers)/.test(r.targetExpression)) {
      findings.push({
        key: `redirect:open:${r.id}`,
        type: "redirect_open_redirect_risk",
        severity: "high",
        title: `${r.name} builds its destination from request input`,
        description: "The target expression uses query string or header values, which may allow attackers to redirect visitors to arbitrary sites (open redirect).",
        recommendation: "Restrict the destination to known hosts.",
        evidence,
        identities: [],
      });
    }

    // Important pages / crawl control files.
    const important = r.sourcePaths.filter((p) => p === "/" || p === "/robots.txt" || p.startsWith("/sitemap"));
    const siteWide = !r.sourcePaths.length && /^\(?\s*(true|http\.host\s+(eq|==)\s+"[^"]+")\s*\)?$/.test(r.expression.trim());
    if (important.length || siteWide) {
      findings.push({
        key: `redirect:important:${r.id}`,
        type: "redirect_affects_important_page",
        severity: important.some((p) => p === "/robots.txt" || p.startsWith("/sitemap")) || siteWide ? "high" : "medium",
        title: `${r.name} redirects ${siteWide ? "the entire host" : important.join(", ")}`,
        description: "Redirecting the homepage, robots.txt or sitemaps changes how every crawler discovers the site. robots.txt and sitemaps should normally be served directly with HTTP 200.",
        recommendation: "Confirm the redirect is intended and that the destination serves the expected content with a 200 status.",
        evidence: { ...evidence, paths: important },
        identities: [],
      });
    }

    // Self-loop: target path equals a source path on the same host.
    if (r.targetUrl) {
      const host = hostOf(r.targetUrl, domain);
      const tPath = pathOf(r.targetUrl, domain);
      if (host && belongsToZone(host, domain) && tPath && r.sourcePaths.includes(tPath)) {
        findings.push({
          key: `redirect:loop:${r.id}`,
          type: "redirect_loop",
          severity: "critical",
          title: `${r.name} redirects ${tPath} to itself`,
          description: "The redirect destination matches the rule's own condition, which produces an infinite redirect loop for every visitor and crawler.",
          recommendation: "Fix the rule condition or destination immediately (human-approved change).",
          evidence,
          identities: [],
        });
      }
    }

    if (r.statusCode === 302 || r.statusCode === 307) {
      findings.push({
        key: `redirect:temporary:${r.id}`,
        type: "redirect_temporary_status",
        severity: "info",
        title: `${r.name} uses a temporary (${r.statusCode}) redirect`,
        description: "Temporary redirects tell search engines to keep the original URL indexed. Use 301/308 for permanent moves.",
        recommendation: "Confirm whether the move is permanent.",
        evidence,
        identities: [],
      });
    }
  }

  // Chains and multi-rule loops: destination of A matches the source of B.
  for (const a of active) {
    if (!a.targetUrl) continue;
    const host = hostOf(a.targetUrl, domain);
    const tPath = pathOf(a.targetUrl, domain);
    if (!host || !belongsToZone(host, domain) || !tPath) continue;
    for (const b of active) {
      if (b.id === a.id || !b.sourcePaths.includes(tPath) || !b.targetUrl) continue;
      const bPath = pathOf(b.targetUrl, domain);
      const loop = bPath !== null && a.sourcePaths.includes(bPath);
      findings.push({
        key: `redirect:${loop ? "multi-loop" : "chain"}:${[a.id, b.id].sort().join(":")}`,
        type: loop ? "redirect_loop" : "redirect_chain",
        severity: loop ? "critical" : "medium",
        title: loop ? `Redirect loop between ${a.name} and ${b.name}` : `Redirect chain: ${a.name} → ${b.name}`,
        description: loop
          ? "These two rules redirect to each other's source paths, creating a loop."
          : "A redirect lands on a URL that is redirected again. Chains slow page loads and waste crawl budget; some crawlers stop following after a few hops.",
        recommendation: loop ? "Fix one of the rules immediately (human-approved change)." : `Point ${a.name} directly at the final destination.`,
        evidence: { first: { id: a.id, target: a.targetUrl }, second: { id: b.id, target: b.targetUrl } },
        identities: [],
      });
    }
  }
  return dedupe(findings);
}

function dedupe(list: DraftFinding[]): DraftFinding[] {
  const map = new Map<string, DraftFinding>();
  for (const f of list) if (!map.has(f.key)) map.set(f.key, f);
  return [...map.values()];
}
