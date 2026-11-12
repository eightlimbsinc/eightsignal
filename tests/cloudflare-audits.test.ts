import { describe, expect, it } from "vitest";
import { auditWafRules, isSiteWide } from "@/lib/cloudflare/waf-audit";
import { auditRedirects, normalizePageRuleRedirects, normalizeSingleRedirects } from "@/lib/cloudflare/redirect-audit";
import type { CfRule } from "@/lib/cloudflare/api";

const rule = (p: Partial<CfRule>): CfRule => ({ id: p.id ?? Math.random().toString(36).slice(2), action: "block", expression: "true", enabled: true, ...p });

describe("auditWafRules", () => {
  it("rates a block on a search crawler UA as critical and a training crawler as low", () => {
    const f = auditWafRules({
      domain: "blend360.com",
      rules: [
        rule({ id: "r1", description: "Block OpenAI search", expression: '(http.user_agent contains "OAI-SearchBot")' }),
        rule({ id: "r2", description: "Block training", expression: '(http.user_agent contains "GPTBot")' }),
      ],
    });
    expect(f.find((x) => x.key === "waf:identity:r1")?.severity).toBe("critical");
    expect(f.find((x) => x.key === "waf:identity:r2")?.severity).toBe("low");
    expect(f.find((x) => x.key === "waf:identity:r1")?.identities).toEqual(["oai-searchbot"]);
  });
  it("flags generic 'bot' matching, verified-bot targeting, site-wide challenges and important paths", () => {
    const f = auditWafRules({
      domain: "x.com",
      rules: [
        rule({ id: "g", action: "managed_challenge", expression: '(lower(http.user_agent) contains "bot")' }),
        rule({ id: "v", expression: "(cf.client.bot)" }),
        rule({ id: "s", action: "managed_challenge", expression: 'http.request.uri.path contains "/"' }),
        rule({ id: "p", action: "js_challenge", expression: '(http.request.uri.path eq "/robots.txt")' }),
      ],
    });
    expect(f.find((x) => x.key === "waf:generic-ua:g")?.severity).toBe("medium");
    expect(f.find((x) => x.key === "waf:verified-bot:v")?.severity).toBe("critical");
    expect(f.find((x) => x.key === "waf:site-wide:s")?.severity).toBe("high");
    expect(f.find((x) => x.key === "waf:important-path:p")).toBeDefined();
  });
  it("does not flag the common 'challenge non-bots' pattern or skip rules", () => {
    const f = auditWafRules({
      domain: "x.com",
      rules: [
        rule({ id: "ok1", action: "managed_challenge", expression: '(ip.src.country eq "XX" and not cf.client.bot)' }),
        rule({ id: "ok2", action: "skip", expression: "(cf.client.bot)" }),
      ],
    });
    expect(f).toEqual([]);
  });
  it("detects deny rules ordered before the verified-bot skip rule", () => {
    const f = auditWafRules({
      domain: "x.com",
      rules: [
        rule({ id: "deny", action: "block", expression: '(http.user_agent contains "python")' }),
        rule({ id: "skip", action: "skip", expression: "(cf.client.bot)" }),
      ],
    });
    expect(f.find((x) => x.key === "waf:order:deny")).toBeDefined();
  });
  it("reports disabled rules as info only", () => {
    const f = auditWafRules({ domain: "x.com", rules: [rule({ id: "d", enabled: false, expression: '(http.user_agent contains "ClaudeBot")' })] });
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("info");
  });
  it("recognises site-wide expressions", () => {
    expect(isSiteWide("true")).toBe(true);
    expect(isSiteWide('(http.request.uri.path wildcard "/*")')).toBe(true);
    expect(isSiteWide('http.request.uri.path contains "/blog"')).toBe(false);
  });
});

describe("auditRedirects", () => {
  const redirect = (id: string, expression: string, target: string, status = 301): CfRule => ({
    id, action: "redirect", enabled: true, expression, description: id,
    action_parameters: { from_value: { status_code: status, target_url: { value: target } } },
  });

  it("detects self loops, bot-specific redirects, verification targets and external destinations", () => {
    const rules = normalizeSingleRedirects([
      redirect("loop", 'http.request.uri.path eq "/services"', "https://www.blend360.com/services"),
      redirect("bots", '(http.user_agent contains "Googlebot")', "https://www.blend360.com/landing"),
      redirect("verify", 'http.request.uri.path eq "/pricing"', "https://www.blend360.com/verify-human"),
      redirect("ext", 'http.request.uri.path eq "/careers"', "https://evil.example/careers"),
    ]);
    const f = auditRedirects(rules, "blend360.com");
    expect(f.find((x) => x.key === "redirect:loop:loop")?.severity).toBe("critical");
    expect(f.find((x) => x.key === "redirect:bot-specific:bots")?.identities).toContain("googlebot");
    expect(f.find((x) => x.key === "redirect:verification:verify")).toBeDefined();
    expect(f.find((x) => x.key === "redirect:external:ext")?.title).toContain("evil.example");
  });
  it("detects chains and two-rule loops", () => {
    const f = auditRedirects(
      normalizeSingleRedirects([
        redirect("a", 'http.request.uri.path eq "/a"', "https://blend360.com/b"),
        redirect("b", 'http.request.uri.path eq "/b"', "https://blend360.com/c"),
        redirect("x", 'http.request.uri.path eq "/x"', "https://blend360.com/y"),
        redirect("y", 'http.request.uri.path eq "/y"', "https://blend360.com/x"),
      ]),
      "blend360.com",
    );
    expect(f.find((x) => x.key === "redirect:chain:a:b")?.type).toBe("redirect_chain");
    expect(f.find((x) => x.key === "redirect:multi-loop:x:y")?.severity).toBe("critical");
  });
  it("flags redirects of robots.txt and temporary status codes", () => {
    const f = auditRedirects(normalizeSingleRedirects([redirect("r", 'http.request.uri.path eq "/robots.txt"', "https://cdn.blend360.com/robots.txt", 302)]), "blend360.com");
    expect(f.find((x) => x.key === "redirect:important:r")?.severity).toBe("high");
    expect(f.find((x) => x.key === "redirect:temporary:r")?.severity).toBe("info");
    expect(f.some((x) => x.type === "redirect_external_destination")).toBe(false); // subdomain is in-zone
  });
  it("normalises legacy Page Rule forwarding URLs", () => {
    const r = normalizePageRuleRedirects([
      { id: "pr", status: "active", priority: 1, targets: [{ target: "url", constraint: { operator: "matches", value: "blend360.com/old" } }], actions: [{ id: "forwarding_url", value: { url: "https://blend360.com/new", status_code: 301 } }] },
    ]);
    expect(r[0]).toMatchObject({ source: "page_rule", sourcePaths: ["/old"], targetUrl: "https://blend360.com/new" });
  });
});
