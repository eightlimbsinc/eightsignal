import { describe, expect, it } from "vitest";
import { canonicalizeUrl, contentFingerprint } from "@/lib/intel/normalize";

describe("canonicalizeUrl", () => {
  it("strips tracking params, fragments, trailing slashes and normalises scheme/host", () => {
    expect(canonicalizeUrl("HTTP://Blog.Cloudflare.com/post/?utm_source=x&b=2&a=1#top")).toBe("https://blog.cloudflare.com/post?a=1&b=2");
    expect(canonicalizeUrl("https://example.com:443/a//b/")).toBe("https://example.com/a/b");
  });
  it("treats variants of the same URL as equal", () => {
    expect(canonicalizeUrl("https://openai.com/news/x?gclid=1")).toBe(canonicalizeUrl("http://openai.com/news/x/"));
  });
  it("rejects non-http URLs", () => {
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });
});

describe("contentFingerprint", () => {
  it("is stable across whitespace, case and punctuation differences", () => {
    expect(contentFingerprint("New  Crawler Controls!", "Cloudflare adds   controls.")).toBe(
      contentFingerprint("new crawler controls", "cloudflare adds controls"),
    );
  });
  it("differs when substance differs", () => {
    expect(contentFingerprint("A", "one")).not.toBe(contentFingerprint("A", "two"));
  });
});
