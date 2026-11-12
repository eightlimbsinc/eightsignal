import ipaddr from "ipaddr.js";

/**
 * Returns true only for globally routable unicast addresses. Rejects loopback,
 * RFC1918 private ranges, link-local (incl. cloud metadata 169.254.169.254),
 * CGNAT, unique-local IPv6, multicast, reserved and unspecified addresses.
 */
export function isPublicIp(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) parsed = v6.toIPv4Address();
  }
  const range = parsed.range();
  if (range !== "unicast") return false;
  if (parsed.kind() === "ipv4") {
    const [a, b] = (parsed as ipaddr.IPv4).octets;
    if (a === 0) return false; // "this network"
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 192 && b === 0) return false; // IETF protocol assignments / TEST-NET-1 (192.0.0/24, 192.0.2/24)
  }
  return true;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata"]);

/** Validates a URL for outbound fetching (protocol, port, credentials, hostname). */
export function validateOutboundUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `Protocol ${url.protocol} is not allowed` };
  }
  if (url.username || url.password) return { ok: false, reason: "URLs with credentials are not allowed" };
  if (url.port && !["80", "443"].includes(url.port)) {
    return { ok: false, reason: `Port ${url.port} is not allowed` };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "Internal hostnames are not allowed" };
  }
  if (ipaddr.isValid(host) && !isPublicIp(host)) {
    return { ok: false, reason: "Private or reserved IP addresses are not allowed" };
  }
  if (!ipaddr.isValid(host) && !host.includes(".")) {
    return { ok: false, reason: "Single-label hostnames are not allowed" };
  }
  return { ok: true, url };
}
