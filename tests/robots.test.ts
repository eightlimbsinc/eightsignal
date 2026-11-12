import { describe, expect, it } from "vitest";
import { analyzeRobots, groupFor, isAllowed, parseRobots } from "@/lib/cloudflare/robots";

const ROBOTS = `# BEGIN Cloudflare Managed content
User-agent: *
Content-Signal: search=yes,ai-train=no
Allow: /

User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /

User-agent: OAI-SearchBot
Allow: /
Disallow: /private/
# END Cloudflare Managed Content

Sitemap: https://www.blend360.com/sitemap.xml
`;

describe("robots.txt parsing", () => {
  const parsed = parseRobots(ROBOTS);
  it("groups multiple user-agents and records sitemaps / content signals", () => {
    expect(parsed.groups).toHaveLength(3);
    expect(parsed.groups[1].agents).toEqual(["gptbot", "claudebot"]);
    expect(parsed.sitemaps).toEqual(["https://www.blend360.com/sitemap.xml"]);
    expect(parsed.contentSignals).toEqual(["search=yes,ai-train=no"]);
    expect(parsed.cloudflareManaged).toBe(true);
  });
  it("selects the specific group over the wildcard", () => {
    expect(groupFor(parsed, "GPTBot").matched).toBe("specific");
    expect(groupFor(parsed, "Googlebot").matched).toBe("wildcard");
  });
  it("applies longest-match semantics", () => {
    const g = groupFor(parsed, "oai-searchbot").group;
    expect(isAllowed(g, "/")).toBe(true);
    expect(isAllowed(g, "/private/x")).toBe(false);
    expect(isAllowed({ agents: ["x"], rules: [{ type: "disallow", path: "/a" }, { type: "allow", path: "/a/b" }] }, "/a/b/c")).toBe(true);
    expect(isAllowed({ agents: ["x"], rules: [{ type: "disallow", path: "/*.pdf$" }] }, "/doc.pdf")).toBe(false);
    expect(isAllowed({ agents: ["x"], rules: [{ type: "disallow", path: "" }] }, "/")).toBe(true);
  });
});

describe("analyzeRobots", () => {
  it("flags training crawlers as low-severity (often intentional) and keeps search crawlers allowed", () => {
    const a = analyzeRobots(ROBOTS);
    const gpt = a.findings.find((f) => f.key === "robots:disallow:gptbot");
    expect(gpt?.severity).toBe("info");
    expect(a.identities.find((i) => i.token === "googlebot")?.homepageAllowed).toBe(true);
    expect(a.wildcardDisallowAll).toBe(false);
  });
  it("flags a site-wide wildcard disallow as critical and search crawlers as high", () => {
    const a = analyzeRobots("User-agent: *\nDisallow: /\n");
    expect(a.findings.find((f) => f.key === "robots:wildcard-disallow-all")?.severity).toBe("critical");
    expect(a.findings.find((f) => f.key === "robots:disallow:googlebot")?.severity).toBe("high");
    expect(a.findings.some((f) => f.key === "robots:no-sitemap")).toBe(true);
  });
});
