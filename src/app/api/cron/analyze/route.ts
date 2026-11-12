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
  // Pick the oldest pending ingested record; stale "running" rows (>10 min) are retried.
  const staleRunning = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: item } = await db
    .from("intelligence_items")
    .select("id")
    .eq("entry_method", "ingestion")
    .or(`analysis_status.eq.pending,and(analysis_status.eq.running,updated_at.lt.${staleRunning})`)
    .order("discovered_at", { ascending: true })
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
