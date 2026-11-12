import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { runZoneAudit } from "@/lib/cloudflare/runner";

export const dynamic = "force-dynamic";
const AUDIT_EVERY_MS = 6 * 3600_000;

/** Audits the most overdue monitored zone (one per call) in read-only mode. */
export async function POST(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  const db = createAdminClient();
  const { data: zones, error } = await db
    .from("cloudflare_zones")
    .select("id, domain, last_audited_at")
    .eq("monitoring_enabled", true)
    .order("last_audited_at", { ascending: true, nullsFirst: true })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const zone = zones?.[0];
  if (!zone || (zone.last_audited_at && Date.now() - new Date(zone.last_audited_at).getTime() < AUDIT_EVERY_MS)) {
    return NextResponse.json({ audited: 0 });
  }
  try {
    const summary = await runZoneAudit(db, zone.id, { trigger: "scheduled", userId: null });
    return NextResponse.json({ audited: 1, domain: zone.domain, ...summary });
  } catch (e) {
    console.error("[cron/cloudflare]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Audit failed" }, { status: 500 });
  }
}
