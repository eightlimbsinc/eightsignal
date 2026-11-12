import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeFetchWithRetry, sleep } from "@/lib/security/safe-fetch";
import { extractLinks } from "@/lib/intel/html";
import { createIntelligence } from "@/lib/intel/service";
import type { Source } from "@/lib/types";
import { parseFeed, type CollectedEntry } from "./adapters/feed";

const MAX_ITEMS_PER_SOURCE = 25;

/** Adapter dispatch: one collector per source type. */
export async function collect(source: Source): Promise<CollectedEntry[]> {
  switch (source.source_type) {
    case "rss":
    case "atom": {
      const res = await safeFetchWithRetry(source.source_url, {
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
        timeoutMs: 15_000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${res.finalUrl}`);
      return parseFeed(res.body);
    }
    case "changelog_page":
    case "announcement_page": {
      const res = await safeFetchWithRetry(source.source_url, { timeoutMs: 15_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${res.finalUrl}`);
      return extractLinks(res.body, res.finalUrl, source.config.link_pattern).map((l) => ({
        title: l.text,
        url: l.url,
        publishedAt: null, // listing pages rarely expose reliable dates; never guessed
        content: null,
      }));
    }
    case "api":
      throw new Error("API sources need a provider-specific adapter; none is registered for this source yet");
    case "manual":
      return [];
  }
}

export interface IngestionOutcome {
  sourceId: string;
  name: string;
  status: "success" | "partial" | "failed";
  found: number;
  created: number;
  duplicates: number;
  createdIds: string[];
  error?: string;
}

/** Collects one source, deduplicates, stores new records and logs the run. */
export async function ingestSource(db: SupabaseClient, source: Source, trigger: "scheduled" | "manual"): Promise<IngestionOutcome> {
  const { data: log } = await db
    .from("ingestion_logs")
    .insert({ source_id: source.id, status: "running", trigger })
    .select("id")
    .single();
  const outcome: IngestionOutcome = { sourceId: source.id, name: source.name, status: "success", found: 0, created: 0, duplicates: 0, createdIds: [] };
  const errors: string[] = [];
  try {
    const entries = (await collect(source)).slice(0, source.config.max_items ?? MAX_ITEMS_PER_SOURCE);
    outcome.found = entries.length;
    for (const e of entries) {
      try {
        const res = await createIntelligence(db, {
          title: e.title,
          provider: source.provider,
          category: source.default_category ?? "other",
          sourceUrl: e.url,
          publishedAt: e.publishedAt,
          rawContent: e.content,
          sourceId: source.id,
          entryMethod: "ingestion",
        });
        if (res.status === "created") {
          outcome.created++;
          outcome.createdIds.push(res.id);
        } else outcome.duplicates++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (errors.length) outcome.status = outcome.created > 0 || outcome.duplicates > 0 ? "partial" : "failed";
  } catch (err) {
    outcome.status = "failed";
    errors.push(err instanceof Error ? err.message : String(err));
  }
  outcome.error = errors.length ? errors.slice(0, 3).join(" | ").slice(0, 1000) : undefined;
  const now = new Date().toISOString();
  if (log) {
    await db.from("ingestion_logs").update({
      status: outcome.status, records_found: outcome.found, records_created: outcome.created,
      records_duplicate: outcome.duplicates, error_message: outcome.error ?? null, completed_at: now,
    }).eq("id", log.id);
  }
  await db.from("sources").update({
    last_checked_at: now,
    ...(outcome.status !== "failed" ? { last_success_at: now, last_error: null, consecutive_failures: 0 } : {
      last_error: outcome.error ?? "Unknown error",
      consecutive_failures: source.consecutive_failures + 1,
    }),
  }).eq("id", source.id);
  return outcome;
}

/** Runs every active source that is due, sequentially with a small delay (politeness rate limit). */
export async function ingestDueSources(db: SupabaseClient, opts: { force?: boolean; deadlineMs?: number } = {}) {
  const { data: sources, error } = await db.from("sources").select("*").eq("is_active", true);
  if (error) throw new Error(error.message);
  const now = Date.now();
  const deadline = now + (opts.deadlineMs ?? 20_000);
  const due = (sources as Source[]).filter((s) => {
    if (opts.force || !s.last_checked_at) return true;
    // Back off failing sources: interval doubles per consecutive failure (max 8x).
    const factor = Math.min(8, 2 ** s.consecutive_failures);
    return now - new Date(s.last_checked_at).getTime() >= s.check_interval_minutes * 60_000 * factor;
  });
  const outcomes: IngestionOutcome[] = [];
  for (const s of due) {
    if (Date.now() > deadline) break; // remaining sources run on the next schedule
    outcomes.push(await ingestSource(db, s, "scheduled"));
    await sleep(300);
  }
  return { due: due.length, processed: outcomes.length, outcomes };
}
