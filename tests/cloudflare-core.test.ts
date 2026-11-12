import { describe, expect, it, vi } from "vitest";
import { diffConfigs, configHash } from "@/lib/cloudflare/snapshot";
import { computeHealth } from "@/lib/cloudflare/health";
import { classifyAccess, detectChallenge, sanitizeHeaders } from "@/lib/cloudflare/access";
import { decryptSecret, encryptSecret, parseKey, validateTokenShape } from "@/lib/cloudflare/credentials";
import { CloudflareReadOnlyClient } from "@/lib/cloudflare/api";
import { CRAWLERS, identitiesMentioned } from "@/lib/cloudflare/crawlers";
import type { CheckResult } from "@/lib/types";

describe("snapshot diff", () => {
  it("detects added, removed, modified and re-ordered rules but ignores volatile fields", () => {
    const before = { rules: [{ id: "a", action: "block", expression: "x", version: "1" }, { id: "b", action: "log", expression: "y" }] };
    const after = { rules: [{ id: "c", action: "skip", expression: "z" }, { id: "a", action: "managed_challenge", expression: "x", version: "2" }] };
    const d = diffConfigs(before, after);
    expect(d.find((x) => x.kind === "added")?.id).toBe("c");
    expect(d.find((x) => x.kind === "removed")?.id).toBe("b");
    const mod = d.find((x) => x.kind === "modified");
    expect(mod?.changes?.map((c) => c.field).sort()).toEqual(["action", "position"]);
  });
  it("hashes canonically (key order independent)", () => {
    expect(configHash({ a: 1, b: { c: 2, d: 3 } })).toBe(configHash({ b: { d: 3, c: 2 }, a: 1 }));
  });
  it("diffs plain objects field by field", () => {
    expect(diffConfigs({ ai_bots_protection: "disabled" }, { ai_bots_protection: "block" })[0].changes).toEqual([
      { field: "ai_bots_protection", before: "disabled", after: "block" },
    ]);
  });
});

describe("computeHealth", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  const all: CheckResult[] = ["api_connection", "waf_rules", "redirect_rules", "robots_txt", "access_tests"].map((c) => ({ check: c, status: "completed" }));
  it("is not connected without connection or audit", () => {
    expect(computeHealth({ connected: false, lastAuditAt: null, checks: [], openFindingSeverities: [], now }).status).toBe("not_connected");
  });
  it("never reports healthy merely because the API connection works", () => {
    expect(computeHealth({ connected: true, lastAuditAt: null, checks: [], openFindingSeverities: [], now }).status).toBe("needs_review");
    expect(computeHealth({ connected: true, lastAuditAt: "2026-11-11T00:00:00Z", checks: [{ check: "api_connection", status: "completed" }], openFindingSeverities: [], now }).status).toBe("needs_review");
  });
  it("is healthy only when all required checks completed recently with no significant findings", () => {
    expect(computeHealth({ connected: true, lastAuditAt: "2026-11-11T00:00:00Z", checks: all, openFindingSeverities: ["low", "info"], now }).status).toBe("healthy");
    expect(computeHealth({ connected: true, lastAuditAt: "2026-10-01T00:00:00Z", checks: all, openFindingSeverities: [], now }).status).toBe("needs_review");
  });
  it("escalates on findings", () => {
    expect(computeHealth({ connected: true, lastAuditAt: "2026-11-11T00:00:00Z", checks: all, openFindingSeverities: ["critical"], now }).status).toBe("critical");
    expect(computeHealth({ connected: true, lastAuditAt: "2026-11-11T00:00:00Z", checks: all, openFindingSeverities: ["high"], now }).status).toBe("warning");
  });
});

describe("access classification", () => {
  it("detects Cloudflare challenges via cf-mitigated and body markers", () => {
    expect(detectChallenge(403, { "cf-mitigated": "challenge" }, "")).toBe(true);
    expect(detectChallenge(403, {}, "<title>Just a moment...</title>")).toBe(true);
    expect(detectChallenge(200, {}, "Just a moment...")).toBe(false);
  });
  it("classifies results", () => {
    const base = { headers: {}, body: "", redirectChain: [], requestedUrl: "https://a.com/", finalUrl: "https://a.com/" };
    expect(classifyAccess({ ...base, status: 200 }).result).toBe("accessible");
    expect(classifyAccess({ ...base, status: 403 }).result).toBe("blocked");
    expect(classifyAccess({ ...base, status: 503, body: "cdn-cgi/challenge-platform" }).result).toBe("challenged");
    expect(classifyAccess({ ...base, status: 200, redirectChain: [{ url: "https://a.com/", status: 301, location: "https://b.com/" }], finalUrl: "https://b.com/" }).result).toBe("redirected");
  });
  it("drops cookies and keeps diagnostic headers", () => {
    expect(sanitizeHeaders({ "set-cookie": "s=1", "cf-ray": "abc", server: "cloudflare" })).toEqual({ "cf-ray": "abc", server: "cloudflare" });
  });
});

describe("credentials", () => {
  const key = parseKey(Buffer.alloc(32, 7).toString("base64"));
  it("round-trips AES-256-GCM and detects tampering", () => {
    const enc = encryptSecret("cf-token-value-1234567890abcdefghijkl", key);
    expect(enc).not.toContain("cf-token");
    expect(decryptSecret(enc, key)).toBe("cf-token-value-1234567890abcdefghijkl");
    const tampered = Buffer.from(enc, "base64");
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptSecret(tampered.toString("base64"), key)).toThrow();
  });
  it("rejects Global API Keys and malformed tokens", () => {
    expect(validateTokenShape("0123456789abcdef0123456789abcdef01234")).toMatch(/Global API Key/);
    expect(validateTokenShape("short")).toBeTruthy();
    expect(validateTokenShape("A".repeat(40))).toBeNull();
  });
  it("requires a 32-byte key", () => {
    expect(() => parseKey("abc")).toThrow();
    expect(() => parseKey(undefined)).toThrow();
  });
});

describe("CloudflareReadOnlyClient", () => {
  it("only issues GET requests to REST endpoints and maps 404/403", async () => {
    const calls: { url: string; method?: string }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      if (String(url).includes("dynamic_redirect")) return new Response(JSON.stringify({ success: false, errors: [{ code: 10003, message: "not found" }] }), { status: 404 });
      if (String(url).includes("bot_management")) return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }), { status: 403 });
      return new Response(JSON.stringify({ success: true, result: { id: "rs", phase: "http_request_firewall_custom", rules: [] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new CloudflareReadOnlyClient("token", fetchImpl);
    expect((await c.getPhaseEntrypoint("z", "http_request_firewall_custom")).ok).toBe(true);
    const r = await c.getPhaseEntrypoint("z", "http_request_dynamic_redirect");
    expect(!r.ok && r.reason).toBe("not_found");
    const b = await c.getBotManagement("z");
    expect(!b.ok && b.reason).toBe("forbidden");
    expect(calls.every((x) => x.method === "GET")).toBe(true);
  });
});

describe("crawler registry", () => {
  it("keeps the four identity classes separate", () => {
    const classes = new Set(CRAWLERS.map((c) => c.class));
    expect([...classes].sort()).toEqual(["browser_agent", "search", "training", "user_directed"]);
    expect(CRAWLERS.find((c) => c.key === "claude-searchbot")?.class).toBe("search");
    expect(CRAWLERS.find((c) => c.key === "claudebot")?.class).toBe("training");
    expect(CRAWLERS.find((c) => c.key === "claude-user")?.class).toBe("user_directed");
  });
  it("does not confuse ClaudeBot with Claude-SearchBot", () => {
    expect(identitiesMentioned('http.user_agent contains "Claude-SearchBot"').map((i) => i.key)).toEqual(["claude-searchbot"]);
  });
});

import { assessAccessOutcomes } from "@/lib/cloudflare/access";

describe("assessAccessOutcomes (data-centre calibration)", () => {
  const u = { urlId: "u1", url: "https://www.blend360.com/" };
  it("treats a challenged baseline as medium (verify manually), not critical, and skips crawler comparisons", () => {
    const f = assessAccessOutcomes([
      { ...u, identity: "browser", name: "Browser", result: "challenged", status: 403 },
      { ...u, identity: "googlebot", name: "Googlebot", identityClass: "search", result: "challenged", status: 403 },
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ type: "access_server_challenged", severity: "medium" });
  });
  it("rates a 5xx as critical and a timeout as high", () => {
    expect(assessAccessOutcomes([{ ...u, identity: "browser", name: "B", result: "error", status: 502 }])[0].severity).toBe("critical");
    expect(assessAccessOutcomes([{ ...u, identity: "browser", name: "B", result: "timeout", status: null }])[0].severity).toBe("high");
  });
  it("rates a spoofed crawler being denied as low (training: info), never high", () => {
    const f = assessAccessOutcomes([
      { ...u, identity: "browser", name: "B", result: "accessible", status: 200 },
      { ...u, identity: "googlebot", name: "Googlebot", identityClass: "search", result: "challenged", status: 403 },
      { ...u, identity: "gptbot", name: "GPTBot", identityClass: "training", result: "blocked", status: 403 },
    ]);
    expect(f.map((x) => x.severity).sort()).toEqual(["info", "low"]);
  });
  it("produces nothing when everything is accessible", () => {
    expect(assessAccessOutcomes([{ ...u, identity: "browser", name: "B", result: "accessible", status: 200 }])).toEqual([]);
  });
});
