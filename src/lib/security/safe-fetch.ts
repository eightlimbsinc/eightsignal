import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import zlib from "node:zlib";
import type { LookupFunction } from "node:net";
import { isPublicIp, validateOutboundUrl } from "./ip";

export interface RedirectHop {
  url: string;
  status: number;
  location: string | null;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: string;
  finalUrl: string;
  redirectChain: RedirectHop[];
  timeMs: number;
  truncated: boolean;
}

export interface SafeFetchOptions {
  userAgent?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  method?: "GET" | "HEAD";
  accept?: string;
  /** Do not follow redirects; return the 3xx response instead. */
  manualRedirect?: boolean;
}

export class SafeFetchError extends Error {
  constructor(
    message: string,
    public readonly kind: "blocked" | "timeout" | "network" | "too_many_redirects" | "too_large",
    public readonly redirectChain: RedirectHop[] = [],
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export const DEFAULT_USER_AGENT =
  "EightSignal/1.0 (+internal monitoring; 8limbs Inc.)";

/**
 * DNS lookup that refuses non-public addresses. Because the validated address is
 * the one the socket connects to, this also defeats DNS-rebinding attacks.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = (addresses as dns.LookupAddress[]) ?? [];
    const bad = list.find((a) => !isPublicIp(a.address));
    if (list.length === 0 || bad) {
      const e = new Error(`Blocked: ${hostname} resolves to a non-public address`) as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return callback(e, "", 4);
    }
    if ((options as { all?: boolean }).all) {
      return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    }
    callback(null, list[0].address, list[0].family);
  });
};

function requestOnce(
  url: URL,
  opts: Required<Pick<SafeFetchOptions, "userAgent" | "timeoutMs" | "maxBytes" | "method" | "accept">>,
  deadline: number,
): Promise<{ status: number; headers: Record<string, string>; body: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const remaining = Math.max(1, deadline - Date.now());
    const req = lib.request(
      url,
      {
        method: opts.method,
        lookup: guardedLookup,
        headers: {
          "user-agent": opts.userAgent,
          accept: opts.accept,
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en-US,en;q=0.8",
        },
        timeout: remaining,
        agent: false,
      },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
        }
        const status = res.statusCode ?? 0;
        if (opts.method === "HEAD" || (status >= 300 && status < 400)) {
          res.resume();
          return resolve({ status, headers, body: "", truncated: false });
        }
        let stream: NodeJS.ReadableStream = res;
        const enc = (headers["content-encoding"] ?? "").toLowerCase();
        if (enc.includes("gzip")) stream = res.pipe(zlib.createGunzip());
        else if (enc.includes("br")) stream = res.pipe(zlib.createBrotliDecompress());
        else if (enc.includes("deflate")) stream = res.pipe(zlib.createInflate());
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        stream.on("data", (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > opts.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxBytes)));
            res.destroy();
            resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8"), truncated });
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => {
          if (!truncated) resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8"), truncated });
        });
        stream.on("error", (e) => {
          if (!truncated) reject(new SafeFetchError(`Decode error: ${e.message}`, "network"));
        });
      },
    );
    req.on("timeout", () => req.destroy(new SafeFetchError("Request timed out", "timeout")));
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e instanceof SafeFetchError) return reject(e);
      if (e.code === "EBLOCKED") return reject(new SafeFetchError(e.message, "blocked"));
      reject(new SafeFetchError(e.message, "network"));
    });
    req.end();
  });
}

/**
 * Outbound HTTP for untrusted URLs: protocol/port allowlist, private-IP blocking
 * at DNS-resolution time, per-hop redirect validation, overall timeout and body cap.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = {
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    timeoutMs: options.timeoutMs ?? 15_000,
    maxBytes: options.maxBytes ?? 3_000_000,
    method: options.method ?? "GET",
    accept: options.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  } as const;
  const maxRedirects = options.maxRedirects ?? 8;
  const start = Date.now();
  const deadline = start + opts.timeoutMs;
  const chain: RedirectHop[] = [];
  const seen = new Set<string>();

  let current = rawUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const check = validateOutboundUrl(current);
    if (!check.ok) throw new SafeFetchError(`Blocked URL ${current}: ${check.reason}`, "blocked", chain);
    const url = check.url;
    const res = await requestOnce(url, opts, deadline).catch((e) => {
      if (e instanceof SafeFetchError) {
        throw new SafeFetchError(e.message, e.kind, chain);
      }
      throw e;
    });
    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.location;
    if (isRedirect && !options.manualRedirect) {
      const next = new URL(res.headers.location!, url).toString();
      chain.push({ url: url.toString(), status: res.status, location: next });
      seen.add(url.toString());
      if (seen.has(next)) {
        throw new SafeFetchError(`Redirect loop detected at ${next}`, "too_many_redirects", chain);
      }
      current = next;
      continue;
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: res.headers,
      body: res.body,
      finalUrl: url.toString(),
      redirectChain: chain,
      timeMs: Date.now() - start,
      truncated: res.truncated,
    };
  }
  throw new SafeFetchError(`Exceeded ${maxRedirects} redirects`, "too_many_redirects", chain);
}

/** Retries transient failures (network errors, timeouts, 429, 5xx) with backoff. */
export async function safeFetchWithRetry(
  url: string,
  options: SafeFetchOptions & { retries?: number } = {},
): Promise<SafeFetchResult> {
  const retries = options.retries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await safeFetch(url, options);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(backoff(attempt));
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (e instanceof SafeFetchError && (e.kind === "blocked" || e.kind === "too_large")) throw e;
      if (attempt < retries) await sleep(backoff(attempt));
    }
  }
  throw lastError;
}

function backoff(attempt: number) {
  return 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}
export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
