import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { PROVIDERS } from "@/lib/intel/taxonomy";
import { analyzeIntelligence, AnalysisError } from "./analyze";

export class RateLimitedError extends Error {}

/** DB-backed per-user limit (works across stateless serverless invocations). */
export async function assertWithinAiRateLimit(db: SupabaseClient, userId: string) {
  const limit = serverEnv.aiAnalysesPerHour();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await db
    .from("activity_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", "intelligence.analyze")
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  if ((count ?? 0) >= limit) {
    throw new RateLimitedError(`AI analysis limit reached (${limit} per hour). Try again later.`);
  }
}

/** Rule-based client matching on recorded tech stacks (complements the AI mapping). */
export function ruleBasedClientMatches(
  provider: string,
  text: string,
  clients: { id: string; name: string; cdn_provider: string | null; hosting_provider: string | null; platform: string | null; technology_stack: string[]; active_services: string[] }[],
): { clientId: string; reason: string }[] {
  const def = PROVIDERS.find((p) => p.key === provider);
  if (!def || !def.stackKeywords.length) return [];
  const out: { clientId: string; reason: string }[] = [];
  for (const c of clients) {
    const stack = [c.cdn_provider, c.hosting_provider, c.platform, ...c.technology_stack].filter(Boolean).join(" ").toLowerCase();
    const hit = def.stackKeywords.find((k) => new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(stack));
    if (hit) out.push({ clientId: c.id, reason: `Client's recorded stack includes ${def.name} (${hit}).` });
  }
  void text;
  return out;
}

/**
 * Analyses one intelligence record and stores the result. `db` may be the user's
 * client (RLS: editors) or the service-role client for scheduled runs.
 */
export async function runAnalysis(db: SupabaseClient, itemId: string, userId: string | null) {
  const { data: item, error } = await db
    .from("intelligence_items")
    .select("id, title, provider, category, source_url, published_at, discovered_at, raw_content, summary, analysis_status")
    .eq("id", itemId)
    .single();
  if (error || !item) throw new Error("Intelligence record not found");
  const content = [item.summary, item.raw_content].filter(Boolean).join("\n\n");
  if (!content.trim()) {
    await db.from("intelligence_items").update({ analysis_status: "skipped", analysis_error: "No content to analyse" }).eq("id", itemId);
    throw new AnalysisError("This record has no content to analyse. Add content or a summary first.", false);
  }

  await db.from("intelligence_items").update({ analysis_status: "running", analysis_error: null }).eq("id", itemId);
  const { data: clients } = await db
    .from("clients")
    .select("id, name, cdn_provider, hosting_provider, platform, technology_stack, active_services");

  try {
    const run = await analyzeIntelligence(
      {
        title: item.title, provider: item.provider, category: item.category, source_url: item.source_url,
        published_at: item.published_at, discovered_at: item.discovered_at, content,
      },
      clients ?? [],
    );
    const a = run.analysis;
    await db.from("ai_analyses").update({ is_current: false }).eq("intelligence_id", itemId).eq("is_current", true);
    const { data: saved, error: saveErr } = await db
      .from("ai_analyses")
      .insert({
        intelligence_id: itemId,
        what_happened: a.what_happened,
        why_it_matters: a.why_it_matters,
        affected_teams: a.who_is_affected.teams,
        departments: a.who_is_affected.departments,
        risk_assessment: a.risk_assessment,
        opportunity_assessment: a.opportunity_assessment,
        recommended_actions: a.recommended_actions,
        affected_clients: a.affected_clients,
        impact_level: a.impact_level,
        confidence_score: a.confidence_score,
        confidence_rationale: a.confidence_rationale,
        source_classification: a.source_classification,
        summary: a.summary,
        model: run.model,
        input_tokens: run.inputTokens,
        output_tokens: run.outputTokens,
        requested_by: userId,
      })
      .select("id")
      .single();
    if (saveErr) throw new Error(`Could not store analysis: ${saveErr.message}`);

    await db.from("intelligence_items").update({
      analysis_status: "completed",
      analysis_error: null,
      impact_level: a.impact_level,
      summary: item.summary ?? a.summary,
    }).eq("id", itemId);

    // Client impact mapping: AI-suggested (validated against registry) + rule-based.
    const byName = new Map((clients ?? []).map((c) => [c.name.toLowerCase(), c.id]));
    const impacts = new Map<string, { reason: string; action: string | null; origin: "ai" | "rule" }>();
    for (const c of a.affected_clients) {
      const id = byName.get(c.client_name.toLowerCase());
      if (id) impacts.set(id, { reason: c.reason, action: c.recommended_action, origin: "ai" });
    }
    for (const m of ruleBasedClientMatches(item.provider, content, clients ?? [])) {
      if (!impacts.has(m.clientId)) impacts.set(m.clientId, { reason: m.reason, action: null, origin: "rule" });
    }
    for (const [clientId, v] of impacts) {
      await db.from("client_impacts").upsert(
        { intelligence_id: itemId, client_id: clientId, impact_reason: v.reason, recommended_action: v.action, origin: v.origin },
        { onConflict: "intelligence_id,client_id", ignoreDuplicates: true },
      );
    }
    await logActivity(db, {
      userId, action: "intelligence.analyze", entityType: "intelligence_item", entityId: itemId,
      metadata: { analysis_id: saved.id, model: run.model, impact: a.impact_level, rejected_clients: a.rejected_clients },
    });
    return { analysisId: saved.id, impact: a.impact_level };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analysis failed";
    await db.from("intelligence_items").update({ analysis_status: "failed", analysis_error: message.slice(0, 1000) }).eq("id", itemId);
    if (userId) {
      await logActivity(db, { userId, action: "intelligence.analyze", entityType: "intelligence_item", entityId: itemId, metadata: { failed: true, error: message.slice(0, 300) } });
    }
    throw e;
  }
}
