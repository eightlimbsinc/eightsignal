import { XMLParser } from "fast-xml-parser";
import { stripTags } from "@/lib/intel/html";

export interface CollectedEntry {
  title: string;
  url: string | null;
  publishedAt: string | null;
  content: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  // Defend against entity-expansion payloads in hostile feeds.
  htmlEntities: false,
  trimValues: true,
});

function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["#text"] === "string") return o["#text"] as string;
  }
  return null;
}

function toIso(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

/** Parses RSS 2.0, RSS 1.0 (RDF) and Atom feeds. Missing fields stay null. */
export function parseFeed(xml: string): CollectedEntry[] {
  if (/<!ENTITY/i.test(xml)) throw new Error("Feed declares XML entities; refusing to parse");
  const doc = parser.parse(xml) as Record<string, unknown>;
  const out: CollectedEntry[] = [];

  const rss = doc.rss as { channel?: { item?: unknown } } | undefined;
  const rdf = doc["rdf:RDF"] as { item?: unknown } | undefined;
  const rssItems = asArray((rss?.channel?.item ?? rdf?.item) as Record<string, unknown>[] | undefined);
  for (const it of rssItems) {
    const title = text(it.title);
    if (!title) continue;
    const link = text(it.link) ?? text((it.guid as Record<string, unknown>)?.["#text"] ?? it.guid);
    const content = text(it["content:encoded"]) ?? text(it.description);
    out.push({
      title: stripTags(title),
      url: link && /^https?:\/\//.test(link) ? link : null,
      publishedAt: toIso(it.pubDate ?? it["dc:date"]),
      content: content ? stripTags(content) : null,
    });
  }

  const feed = doc.feed as { entry?: unknown } | undefined;
  for (const e of asArray(feed?.entry as Record<string, unknown>[] | undefined)) {
    const title = text(e.title);
    if (!title) continue;
    const links = asArray(e.link as Record<string, string>[] | Record<string, string> | undefined);
    const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
    const content = text(e.content) ?? text(e.summary);
    out.push({
      title: stripTags(title),
      url: alt?.["@_href"] ?? null,
      publishedAt: toIso(e.published ?? e.updated),
      content: content ? stripTags(content) : null,
    });
  }
  return out;
}
