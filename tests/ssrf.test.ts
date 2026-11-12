import { describe, expect, it } from "vitest";
import { isPublicIp, validateOutboundUrl } from "@/lib/security/ip";
import { safeFetch, SafeFetchError } from "@/lib/security/safe-fetch";

describe("isPublicIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1", "192.0.2.10"])(
    "blocks %s",
    (ip) => expect(isPublicIp(ip)).toBe(false),
  );
  it.each(["1.1.1.1", "104.16.0.1", "2606:4700::1111"])("allows %s", (ip) => expect(isPublicIp(ip)).toBe(true));
});

describe("validateOutboundUrl", () => {
  it.each([
    ["file:///etc/passwd", "Protocol"],
    ["gopher://example.com", "Protocol"],
    ["http://localhost/", "Internal"],
    ["http://metadata.google.internal/", "Internal"],
    ["http://169.254.169.254/latest/meta-data", "Private"],
    ["http://[::1]/", "Private"],
    ["https://user:pass@example.com/", "credentials"],
    ["https://example.com:8080/", "Port"],
    ["http://intranet/", "Single-label"],
  ])("rejects %s", (url, reason) => {
    const r = validateOutboundUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(new RegExp(reason, "i"));
  });
  it("accepts a normal https URL", () => {
    expect(validateOutboundUrl("https://blog.cloudflare.com/x").ok).toBe(true);
  });
});

describe("safeFetch", () => {
  it("refuses loopback targets before connecting", async () => {
    await expect(safeFetch("http://127.0.0.1/")).rejects.toMatchObject({ kind: "blocked" });
  });
  it("refuses hostnames that resolve to private addresses (DNS-time check)", async () => {
    // localtest.me style names are not guaranteed offline; use a literal that DNS resolves locally.
    await expect(safeFetch("http://localhost./")).rejects.toBeInstanceOf(SafeFetchError);
  });
});
