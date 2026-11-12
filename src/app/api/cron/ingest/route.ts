import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestDueSources } from "@/lib/ingestion/run";

export const dynamic = "force-dynamic";

/** Called by the Netlify scheduled function. Collects due sources within a time budget. */
export async function POST(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  try {
    const result = await ingestDueSources(createAdminClient(), { deadlineMs: 18_000 });
    return NextResponse.json({
      due: result.due,
      processed: result.processed,
      outcomes: result.outcomes.map(({ createdIds, ...o }) => ({ ...o, created_ids: createdIds.length })),
    });
  } catch (e) {
    console.error("[cron/ingest]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ingestion failed" }, { status: 500 });
  }
}
