/**
 * Minimal, dependency-free HTML text extraction. Output is plain text only —
 * it is never rendered as HTML — so markup in untrusted pages cannot execute.
 */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "";
      try {
        return String.fromCodePoint(n);
      } catch {
        return "";
      }
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|iframe|template|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${key.replace(/[.:]/g, "\\$&")}["'][^>]*>`,
      "i",
    );
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content && content.trim()) return decodeEntities(content.trim());
  }
  return null;
}

export interface ExtractedPage {
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  canonicalUrl: string | null;
  siteName: string | null;
  text: string;
}

function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1995 || d.getTime() > Date.now() + 86_400_000 * 2) return null;
  return d.toISOString();
}

/** Extracts article metadata and main text. Missing fields stay null — never guessed. */
export function extractPage(html: string, baseUrl: string): ExtractedPage {
  const title =
    metaContent(html, ["og:title", "twitter:title"]) ??
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1].replace(/\s+/g, " ").trim())
      : null);
  const description = metaContent(html, ["og:description", "description", "twitter:description"]);
  const publishedAt = parseDate(
    metaContent(html, ["article:published_time", "og:published_time", "datePublished", "pubdate", "date"]) ??
      html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ??
      html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1],
  );
  const canonicalHref = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1];
  let canonicalUrl: string | null = null;
  if (canonicalHref) {
    try {
      canonicalUrl = new URL(canonicalHref, baseUrl).toString();
    } catch {
      canonicalUrl = null;
    }
  }
  const siteName = metaContent(html, ["og:site_name"]);
  const main =
    html.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
    html.match(/<main[\s\S]*?<\/main>/i)?.[0] ??
    html.match(/<body[\s\S]*?<\/body>/i)?.[0] ??
    html;
  const text = stripTags(main).slice(0, 60_000);
  return { title, description, publishedAt, canonicalUrl, siteName, text };
}

export interface ExtractedLink {
  url: string;
  text: string;
}

/** Extracts same-site links whose path matches `pattern` (used for changelog/announcement pages). */
export function extractLinks(html: string, baseUrl: string, pattern?: string): ExtractedLink[] {
  const base = new URL(baseUrl);
  const re = pattern ? new RegExp(pattern) : null;
  const out = new Map<string, ExtractedLink>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], base);
    } catch {
      continue;
    }
    if (u.hostname !== base.hostname) continue;
    if (re && !re.test(u.pathname)) continue;
    if (u.pathname === base.pathname) continue;
    const text = stripTags(m[2]).replace(/\s+/g, " ").trim();
    if (text.length < 4) continue;
    u.hash = "";
    const key = u.toString();
    const existing = out.get(key);
    if (!existing || text.length > existing.text.length) out.set(key, { url: key, text: text.slice(0, 300) });
  }
  return [...out.values()];
}
