import type { CfRule } from "./api";
import { CRAWLERS, identitiesMentioned, type CrawlerIdentity } from "./crawlers";
import type { DraftFinding } from "./findings";
import type { Severity } from "@/lib/types";

const DENY_ACTIONS = new Set(["block", "challenge", "managed_challenge", "js_challenge"]);
const GENERIC_BOT_TERMS = ["bot", "crawler", "spider", "headless", "python", "curl", "wget", "scrapy", "go-http-client", "httpclient", "java/", "playwright", "puppeteer", "selenium"];
const IMPORTANT_PATHS = ["/robots.txt", "/sitemap", "/llms.txt"];

export interface WafAuditInput {
  rules: CfRule[];
  /** Hostnames that belong to the zone, used to recognise site-wide rules. */
  domain: string;
}

function ruleLabel(rule: CfRule, index: number): string {
  return rule.description?.trim() || `Rule #${index + 1} (${rule.id.slice(0, 8)})`;
}

function evidenceFor(rule: CfRule, index: number) {
  return {
    rule_id: rule.id,
    rule_name: rule.description ?? null,
    position: index + 1,
    action: rule.action,
    enabled: rule.enabled,
    expression: rule.expression,
    last_updated: rule.last_updated ?? null,
  };
}

/** True when the expression matches (roughly) every request, e.g. `true` or path contains "/". */
export function isSiteWide(expression: string): boolean {
  const e = expression.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    e === "true" ||
    e === "(true)" ||
    /^\(?\s*http\.request\.uri\.path\s+(contains|wildcard|matches)\s+"(\/|\/\*|\^\/|\.\*)"\s*\)?$/.test(e) ||
    /^\(?\s*http\.request\.full_uri\s+contains\s+"http"\s*\)?$/.test(e)
  );
}

function severityForIdentities(ids: CrawlerIdentity[], action: string): Severity {
  const classes = new Set(ids.map((i) => i.class));
  const hard = action === "block";
  if (classes.has("search")) return hard ? "critical" : "high";
  if (classes.has("user_directed") || classes.has("browser_agent")) return hard ? "high" : "medium";
  // Blocking training crawlers is frequently intentional policy.
  return "low";
}

/**
 * Heuristic, explainable review of custom WAF rules. Findings are advisory — the
 * rule may be intentional — and the UI presents them for human review only.
 */
export function auditWafRules({ rules }: WafAuditInput): DraftFinding[] {
  const findings: DraftFinding[] = [];
  const skipVerifiedIndex = rules.findIndex(
    (r) => r.enabled && r.action === "skip" && /cf\.(client\.bot|verified_bot_category|bot_management\.verified_bot)/.test(r.expression),
  );

  rules.forEach((rule, index) => {
    const label = ruleLabel(rule, index);
    const expr = rule.expression ?? "";
    const exprLower = expr.toLowerCase();
    const evidence = evidenceFor(rule, index);

    if (!rule.enabled) {
      findings.push({
        key: `waf:disabled:${rule.id}`,
        type: "waf_rule_disabled",
        severity: "info",
        title: `Disabled WAF rule: ${label}`,
        description: "This custom rule exists but is disabled. Disabled rules are harmless today but can unexpectedly change behaviour if re-enabled.",
        recommendation: "Confirm the rule is still needed; document why it is disabled or remove it through your normal change process.",
        evidence,
        identities: [],
      });
      return;
    }
    if (!DENY_ACTIONS.has(rule.action)) {
      if (rule.action === "log") return;
      return;
    }

    const userAgentRule = /http\.user_agent/.test(exprLower);
    const named = identitiesMentioned(exprLower);
    const negated = /not\s+http\.user_agent|!\s*\(?\s*http\.user_agent/.test(exprLower);

    // 1. Rules that name specific crawler / agent identities.
    if (userAgentRule && named.length && !negated) {
      const severity = severityForIdentities(named, rule.action);
      const classes = [...new Set(named.map((n) => n.class))];
      findings.push({
        key: `waf:identity:${rule.id}`,
        type: "waf_blocks_ai_identity",
        severity,
        title: `${label} ${rule.action === "block" ? "blocks" : "challenges"} ${named.map((n) => n.name).join(", ")}`,
        description:
          `This enabled rule matches the user-agent of ${named.map((n) => `${n.name} (${n.class.replace("_", " ")})`).join(", ")} and applies "${rule.action}". ` +
          (classes.includes("search")
            ? "Blocking or challenging search crawlers can remove pages from search and AI search results. "
            : "") +
          (classes.includes("training") && classes.length === 1
            ? "Blocking training crawlers is often an intentional policy; confirm it matches the client's AI policy. "
            : "") +
          "Crawlers cannot solve interactive challenges, so a challenge is effectively a block for them.",
        recommendation:
          classes.includes("training") && classes.length === 1
            ? "Confirm with the client that blocking AI training crawlers is intended and documented."
            : "Review whether this identity should be allowed. If the goal is to stop impersonators, match on Cloudflare's verified-bot signals rather than the user-agent string.",
        evidence: { ...evidence, matched_identities: named.map((n) => n.key) },
        identities: named.map((n) => n.key),
      });
    }

    // 2. Generic bot / automation user-agent matching (catches agents and crawlers broadly).
    const literals = [...exprLower.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    const genericTerms = userAgentRule
      ? GENERIC_BOT_TERMS.filter((t) => literals.some((l) => l.includes(t)))
      : [];
    if (userAgentRule && !negated && genericTerms.length && !named.length) {
      findings.push({
        key: `waf:generic-ua:${rule.id}`,
        type: "waf_generic_bot_match",
        severity: rule.action === "block" ? "high" : "medium",
        title: `${label} matches broad bot/automation user-agents`,
        description: `The expression matches generic terms (${genericTerms.join(", ")}) in the user-agent. Patterns like "bot" also match Googlebot, bingbot, OAI-SearchBot, ClaudeBot and Claude-SearchBot, and automation terms can catch legitimate browser agents.`,
        recommendation: "Narrow the expression, or add `and not cf.client.bot` so verified search crawlers are excluded. Re-run EightSignal access tests after any change.",
        evidence: { ...evidence, generic_terms: genericTerms },
        identities: CRAWLERS.filter((c) => c.class === "search").map((c) => c.key),
      });
    }

    // 3. Rules that act on verified bots themselves.
    if (/cf\.client\.bot|cf\.verified_bot_category/.test(exprLower) && !/not\s+cf\.client\.bot/.test(exprLower)) {
      findings.push({
        key: `waf:verified-bot:${rule.id}`,
        type: "waf_targets_verified_bots",
        severity: rule.action === "block" ? "critical" : "high",
        title: `${label} applies "${rule.action}" to verified bots`,
        description: "This rule matches Cloudflare's verified-bot signal. Verified bots include major search engine crawlers; acting on them can directly harm indexing and AI search visibility.",
        recommendation: "Confirm this is intentional and scoped to specific bot categories. Otherwise invert the condition (`not cf.client.bot`).",
        evidence,
        identities: CRAWLERS.filter((c) => c.class === "search").map((c) => c.key),
      });
    }

    // 4. Site-wide challenge / block.
    if (isSiteWide(expr)) {
      findings.push({
        key: `waf:site-wide:${rule.id}`,
        type: "waf_site_wide_action",
        severity: rule.action === "block" ? "critical" : "high",
        title: `${label} ${rule.action === "block" ? "blocks" : "challenges"} every request`,
        description: "The expression matches all traffic. Every visitor, search crawler and AI agent receives this action. Site-wide challenges are sometimes used during attacks but should be temporary.",
        recommendation: "Verify whether an incident is in progress. If not, scope the rule or switch to a managed challenge that exempts verified bots.",
        evidence,
        identities: CRAWLERS.map((c) => c.key),
      });
    }

    // 5. Rules targeting important crawl-control paths.
    const paths = IMPORTANT_PATHS.filter((p) => exprLower.includes(`"${p}`));
    if (paths.length) {
      findings.push({
        key: `waf:important-path:${rule.id}`,
        type: "waf_affects_important_path",
        severity: "high",
        title: `${label} affects ${paths.join(", ")}`,
        description: "robots.txt and sitemaps must stay reachable by crawlers. A block or challenge on these paths prevents crawlers from reading crawl directives and discovering pages.",
        recommendation: "Exclude robots.txt and sitemap paths from this rule.",
        evidence: { ...evidence, paths },
        identities: CRAWLERS.map((c) => c.key),
      });
    }

    // 6. Ordering: a deny rule that runs before a "skip verified bots" rule makes the skip ineffective.
    if (skipVerifiedIndex > index && (userAgentRule || isSiteWide(expr))) {
      findings.push({
        key: `waf:order:${rule.id}`,
        type: "waf_rule_order",
        severity: "medium",
        title: `${label} runs before the verified-bot skip rule`,
        description: `Custom rules are evaluated in order. This "${rule.action}" rule is at position ${index + 1}, before the rule at position ${skipVerifiedIndex + 1} that skips verified bots, so verified bots can be acted on before they are exempted.`,
        recommendation: "Review rule order in the Cloudflare dashboard. EightSignal never reorders rules automatically.",
        evidence: { ...evidence, skip_rule_position: skipVerifiedIndex + 1 },
        identities: [],
      });
    }
  });
  return findings;
}
