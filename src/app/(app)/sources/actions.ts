"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireEditor, AuthorizationError } from "@/lib/auth";
import { errorMessage, type ActionState } from "@/lib/action-state";
import { CATEGORY_KEYS, PROVIDER_KEYS } from "@/lib/intel/taxonomy";
import { ingestSource } from "@/lib/ingestion/run";
import { validateOutboundUrl } from "@/lib/security/ip";
import { assertWithinAiRateLimit, runAnalysis, RateLimitedError } from "@/lib/ai/run";
import { AnalysisError, isAiConfigured } from "@/lib/ai/analyze";
import { logActivity } from "@/lib/activity";
import type { Source } from "@/lib/types";

function fail(e: unknown): ActionState {
  if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" · ") };
  if (e instanceof AuthorizationError || e instanceof RateLimitedError || e instanceof AnalysisError) return { error: e.message };
  return { error: errorMessage(e) };
}

const SourceSchema = z.object({
  name: z.string().trim().min(2).max(200),
  provider: z.enum(PROVIDER_KEYS as [string, ...string[]]),
  source_url: z.string().trim().url(),
  source_type: z.enum(["rss", "atom", "changelog_page", "announcement_page"]),
  default_category: z.enum(CATEGORY_KEYS),
  link_pattern: z.string().trim().max(200).optional(),
  check_interval_minutes: z.coerce.number().int().min(15).max(10_080),
});

export async function createSource(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const input = SourceSchema.parse(Object.fromEntries(formData));
    const check = validateOutboundUrl(input.source_url);
    if (!check.ok) return { error: check.reason };
    if (input.link_pattern) {
      try {
        new RegExp(input.link_pattern);
      } catch {
        return { error: "Link pattern is not a valid regular expression." };
      }
    }
    const { data, error } = await db.from("sources").insert({
      name: input.name, provider: input.provider, source_url: check.url.toString(), source_type: input.source_type,
      default_category: input.default_category, check_interval_minutes: input.check_interval_minutes,
      config: input.link_pattern ? { link_pattern: input.link_pattern } : {}, is_active: false,
    }).select("id").single();
    if (error) return { error: error.code === "23505" ? "That source URL is already registered." : error.message };
    await logActivity(db, { userId: user.id, action: "source.create", entityType: "source", entityId: data.id });
    revalidatePath("/sources");
    return { ok: true, message: "Source added (inactive). Use “Run now” to verify it, then activate it." };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleSource(formData: FormData) {
  const { db, user } = await requireEditor();
  const id = z.string().uuid().parse(formData.get("id"));
  const active = formData.get("active") === "1";
  await db.from("sources").update({ is_active: active }).eq("id", id);
  await logActivity(db, { userId: user.id, action: active ? "source.activate" : "source.deactivate", entityType: "source", entityId: id });
  revalidatePath("/sources");
}

export async function runSourceNow(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const id = z.string().uuid().parse(formData.get("id"));
    const { data: source } = await db.from("sources").select("*").eq("id", id).single();
    if (!source) return { error: "Source not found." };
    const outcome = await ingestSource(db, source as Source, "manual");
    await logActivity(db, { userId: user.id, action: "source.run", entityType: "source", entityId: id, metadata: { ...outcome, createdIds: undefined } });
    revalidatePath("/sources");
    revalidatePath("/intelligence");
    if (outcome.status === "failed") return { error: `Collection failed: ${outcome.error}` };
    return { ok: true, message: `Found ${outcome.found}, created ${outcome.created}, duplicates ${outcome.duplicates}${outcome.error ? ` (some errors: ${outcome.error})` : ""}.` };
  } catch (e) {
    return fail(e);
  }
}

/** Manual reprocessing: analyse up to two pending/failed records per click (function time limits). */
export async function reprocessPending(_: ActionState, formData: FormData): Promise<ActionState> {
  void formData;
  try {
    const { db, user } = await requireEditor();
    if (!isAiConfigured()) return { error: "ANTHROPIC_API_KEY is not configured." };
    const { data: items } = await db
      .from("intelligence_items")
      .select("id")
      .in("analysis_status", ["pending", "failed"])
      .order("discovered_at", { ascending: false })
      .limit(2);
    if (!items?.length) return { ok: true, message: "Nothing pending analysis." };
    let done = 0;
    const errors: string[] = [];
    for (const it of items) {
      try {
        await assertWithinAiRateLimit(db, user.id);
        await runAnalysis(db, it.id, user.id);
        done++;
      } catch (e) {
        errors.push(errorMessage(e));
        if (e instanceof RateLimitedError) break;
      }
    }
    revalidatePath("/intelligence");
    revalidatePath("/sources");
    return errors.length && !done ? { error: errors.join(" | ") } : { ok: true, message: `Analysed ${done} record(s).${errors.length ? ` Errors: ${errors.join(" | ")}` : ""}` };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Admin-only: deletes a source (and its collection history). With "also delete
 * articles", every article collected from it is deleted too (analyses, notes,
 * bookmarks and client links cascade; tasks are kept, unlinked).
 */
export async function deleteSource(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireAdmin();
    const id = z.string().uuid().parse(formData.get("id"));
    const alsoArticles = formData.get("also_articles") === "on";
    if (formData.get("confirm") !== "on") return { error: "Tick the confirmation box first." };
    const { data: source } = await db.from("sources").select("id, name").eq("id", id).maybeSingle();
    if (!source) return { error: "Source not found." };
    let articles = 0;
    if (alsoArticles) {
      const { data, error } = await db.from("intelligence_items").delete().eq("source_id", id).select("id");
      if (error) return { error: error.message };
      articles = data?.length ?? 0;
    }
    const { data: removed, error } = await db.from("sources").delete().eq("id", id).select("id");
    if (error) return { error: error.message };
    if (!removed?.length) return { error: "Nothing was deleted — administrator access is required." };
    await logActivity(db, { userId: user.id, action: "source.delete", entityType: "source", entityId: id, metadata: { name: source.name, articles_deleted: articles } });
    revalidatePath("/sources");
    revalidatePath("/intelligence");
    revalidatePath("/");
    return { ok: true, message: `Deleted source “${source.name}”${alsoArticles ? ` and ${articles} article(s)` : " (its articles were kept)"}.` };
  } catch (e) {
    return fail(e);
  }
}
