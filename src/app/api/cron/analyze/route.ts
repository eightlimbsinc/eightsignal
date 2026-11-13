import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAnalysis } from "@/lib/ai/run";
import { isAiConfigured } from "@/lib/ai/analyze";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Analyses ONE pending ingested record per call (keeps each run inside function time limits). */
export async function POST(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  if (!isAiConfigured() || !serverEnv.autoAnalyzeIngested()) {
    return NextResponse.json({ skipped: "AI analysis disabled or not configured" });
  }
  const db = createAdminClient();
  // Newest first (by publication date) so current news is assessed before the backlog.
  // Only records from the last AUTO_ANALYZE_MAX_AGE_DAYS (default 30) are auto-analysed;
  // older ones can still be analysed manually. Stale "running" rows (>10 min) are retried.
  const staleRunning = new Date(Date.now() - 10 * 60_000).toISOString();
  const maxAgeDays = Number(process.env.AUTO_ANALYZE_MAX_AGE_DAYS ?? "30");
  const since = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  // Recover records left "running" by a timed-out invocation.
  await db
    .from("intelligence_items")
    .update({ analysis_status: "pending" })
    .eq("analysis_status", "running")
    .lt("updated_at", staleRunning);
  const { data: item } = await db
    .from("intelligence_items")
    .select("id")
    .eq("entry_method", "ingestion")
    .eq("analysis_status", "pending")
    .or(`published_at.gte.${since},and(published_at.is.null,discovered_at.gte.${since})`)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("discovered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!item) return NextResponse.json({ analysed: 0 });
  try {
    const res = await runAnalysis(db, item.id, null);
    return NextResponse.json({ analysed: 1, id: item.id, impact: res.impact });
  } catch (e) {
    return NextResponse.json({ analysed: 0, id: item.id, error: e instanceof Error ? e.message : "failed" }, { status: 200 });
  }
}
