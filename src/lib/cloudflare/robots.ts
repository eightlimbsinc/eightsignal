import { CRAWLERS } from "./crawlers";
import type { DraftFinding } from "./findings";

export interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
}
export interface RobotsGroup {
  agents: string[]; // lower-cased
  rules: RobotsRule[];
}
export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
  contentSignals: string[];
  cloudflareManaged: boolean;
  invalidLines: number;
}

/** RFC 9309 robots.txt parser (groups, allow/disallow, sitemaps). */
export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const contentSignals: string[] = [];
  let invalidLines = 0;
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) {
      invalidLines++;
      continue;
    }
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "allow" || field === "disallow") {
      if (!current) {
        invalidLines++;
        continue;
      }
      current.rules.push({ type: field, path: value });
    } else if (field === "sitemap") {
      sitemaps.push(value);
    } else if (field === "content-signal") {
      contentSignals.push(value);
    }
  }
  return {
    groups,
    sitemaps,
    contentSignals,
    cloudflareManaged: /BEGIN Cloudflare Managed/i.test(text),
    invalidLines,
  };
}

/** Selects the group for an agent token (most specific match, else "*"), per RFC 9309. */
export function groupFor(parsed: ParsedRobots, token: string): { group: RobotsGroup | null; matched: "specific" | "wildcard" | "none" } {
  const t = token.toLowerCase();
  const specific = parsed.groups.filter((g) => g.agents.includes(t));
  if (specific.length) {
    return { group: { agents: [t], rules: specific.flatMap((g) => g.rules) }, matched: "specific" };
  }
  const wildcard = parsed.groups.filter((g) => g.agents.includes("*"));
  if (wildcard.length) {
    return { group: { agents: ["*"], rules: wildcard.flatMap((g) => g.rules) }, matched: "wildcard" };
  }
  return { group: null, matched: "none" };
}

function patternToRegex(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Longest-match evaluation; ties go to Allow. Empty Disallow allows everything. */
export function isAllowed(group: RobotsGroup | null, path: string): boolean {
  if (!group) return true;
  let best: RobotsRule | null = null;
  for (const rule of group.rules) {
    if (rule.path === "") continue;
    if (!patternToRegex(rule.path).test(path)) continue;
    if (
      !best ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.type === "allow")
    ) {
      best = rule;
    }
  }
  return !best || best.type === "allow";
}

export interface RobotsIdentityResult {
  identity: string;
  token: string;
  matched: "specific" | "wildcard" | "none";
  homepageAllowed: boolean;
  directives: RobotsRule[];
}

export interface RobotsAnalysis {
  identities: RobotsIdentityResult[];
  sitemaps: string[];
  wildcardDisallowAll: boolean;
  contentSignals: string[];
  cloudflareManaged: boolean;
  findings: DraftFinding[];
}

export function analyzeRobots(text: string, importantPaths: string[] = ["/"]): RobotsAnalysis {
  const parsed = parseRobots(text);
  const findings: DraftFinding[] = [];
  const identities: RobotsIdentityResult[] = [];

  for (const c of CRAWLERS) {
    for (const token of c.robotsTokens) {
      const { group, matched } = groupFor(parsed, token);
      const homepageAllowed = isAllowed(group, "/");
      identities.push({ identity: c.key, token, matched, homepageAllowed, directives: group?.rules ?? [] });
      const blockedPaths = importantPaths.filter((p) => !isAllowed(group, p));
      if (blockedPaths.length) {
        const severity = c.class === "search" ? "high" : c.class === "training" ? "info" : "medium";
        findings.push({
          key: `robots:disallow:${c.key}`,
          type: "robots_disallows_identity",
          severity,
          title: `robots.txt disallows ${c.name} on ${blockedPaths.join(", ")}`,
          description:
            `${matched === "specific" ? `A group naming ${c.name}` : "The wildcard (*) group"} disallows ${blockedPaths.join(", ")}. ` +
            (c.class === "training"
              ? "Disallowing training crawlers is often intentional — confirm it reflects the client's AI policy."
              : "This asks the crawler not to fetch these pages, which reduces visibility in that provider's search or answers.") +
            " Note: robots.txt is advisory and separate from Cloudflare enforcement.",
          recommendation: c.class === "training" ? "Confirm intent with the client." : `Review whether ${c.name} should be allowed.`,
          evidence: { token, matched_group: matched, directives: group?.rules ?? [] },
          identities: [c.key],
        });
      }
    }
  }

  const wildcard = groupFor(parsed, "*-nonexistent-agent-*");
  const wildcardDisallowAll = wildcard.matched === "wildcard" && !isAllowed(wildcard.group, "/");
  if (wildcardDisallowAll) {
    findings.push({
      key: "robots:wildcard-disallow-all",
      type: "robots_wildcard_disallow_all",
      severity: "critical",
      title: "robots.txt disallows all crawlers by default (User-agent: * / Disallow: /)",
      description: "Every crawler not explicitly allowed is asked to stay off the entire site. This is a common staging-to-production mistake.",
      recommendation: "Confirm intent immediately; production sites normally allow crawling.",
      evidence: { directives: wildcard.group?.rules ?? [] },
      identities: [],
    });
  }
  if (!parsed.sitemaps.length) {
    findings.push({
      key: "robots:no-sitemap",
      type: "robots_missing_sitemap",
      severity: "low",
      title: "robots.txt does not reference a sitemap",
      description: "Sitemap directives help search and AI crawlers discover important pages.",
      recommendation: "Add a `Sitemap:` line pointing to the XML sitemap.",
      evidence: {},
      identities: [],
    });
  }
  if (parsed.invalidLines > 0) {
    findings.push({
      key: "robots:invalid-lines",
      type: "robots_invalid_lines",
      severity: "low",
      title: `robots.txt contains ${parsed.invalidLines} unparseable line(s)`,
      description: "Crawlers ignore lines they cannot parse, which may silently drop intended rules.",
      recommendation: "Review the file for typos.",
      evidence: { invalid_lines: parsed.invalidLines },
      identities: [],
    });
  }
  return {
    identities,
    sitemaps: parsed.sitemaps,
    wildcardDisallowAll,
    contentSignals: parsed.contentSignals,
    cloudflareManaged: parsed.cloudflareManaged,
    findings,
  };
}
