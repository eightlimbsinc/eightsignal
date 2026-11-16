"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin, requireEditor, requireMember, AuthorizationError } from "@/lib/auth";
import { errorMessage, type ActionState } from "@/lib/action-state";
import { createIntelligence, writeTombstones } from "@/lib/intel/service";
import { extractPage } from "@/lib/intel/html";
import { safeFetch, SafeFetchError } from "@/lib/security/safe-fetch";
import { CATEGORY_KEYS, ITEM_STATUSES, PROVIDER_KEYS, PRIORITIES } from "@/lib/intel/taxonomy";
import { assertWithinAiRateLimit, runAnalysis, RateLimitedError } from "@/lib/ai/run";
import { AnalysisError, isAiConfigured } from "@/lib/ai/analyze";
import { logActivity } from "@/lib/activity";

const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? new Date(v).toISOString() : null))
  .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), "Invalid date");

const ManualSchema = z.object({
  title: z.string().trim().min(3, "Title is required").max(500),
  provider: z.enum(PROVIDER_KEYS as [string, ...string[]]),
  category: z.enum(CATEGORY_KEYS),
  source_url: z.string().trim().url("Enter a valid URL").optional().or(z.literal("")),
  published_at: optionalDate,
  content: z.string().trim().max(100_000).optional(),
  summary: z.string().trim().max(5_000).optional(),
});

function fail(e: unknown): ActionState {
  if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" · ") };
  if (e instanceof AuthorizationError) return { error: e.message };
  return { error: errorMessage(e) };
}

export async function createManualEntry(_: ActionState, formData: FormData): Promise<ActionState> {
  let id: string;
  try {
    const { db, user } = await requireEditor();
    const input = ManualSchema.parse(Object.fromEntries(formData));
    if (!input.content && !input.summary) return { error: "Provide the announcement content or a summary." };
    const res = await createIntelligence(db, {
      title: input.title,
      provider: input.provider,
      category: input.category,
      sourceUrl: input.source_url || null,
      publishedAt: input.published_at,
      rawContent: input.content || null,
      summary: input.summary || null,
      entryMethod: "manual",
      createdBy: user.id,
    });
    if (res.status === "duplicate") {
      return {
        error: `Duplicate detected (${res.duplicate.reason.replace("_", " ")}): "${res.duplicate.title}".`,
        href: `/intelligence/${res.duplicate.id}`,
      };
    }
    if (res.status !== "created") return { error: "This article could not be saved." };
    id = res.id;
    await logActivity(db, { userId: user.id, action: "intelligence.create", entityType: "intelligence_item", entityId: id, metadata: { method: "manual" } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/intelligence");
  redirect(`/intelligence/${id}`);
}

const UrlSchema = z.object({
  url: z.string().trim().url("Enter a valid URL"),
  provider: z.enum(PROVIDER_KEYS as [string, ...string[]]),
  category: z.enum(CATEGORY_KEYS),
});

export async function submitUrl(_: ActionState, formData: FormData): Promise<ActionState> {
  let id: string;
  try {
    const { db, user } = await requireEditor();
    const input = UrlSchema.parse(Object.fromEntries(formData));
    let page;
    try {
      const res = await safeFetch(input.url, { timeoutMs: 15_000 });
      if (!res.ok) return { error: `The page returned HTTP ${res.status}. Nothing was saved.` };
      const ct = res.headers["content-type"] ?? "";
      if (!/html|xml|text\/plain/.test(ct)) return { error: `Unsupported content type (${ct || "unknown"}).` };
      page = { ...extractPage(res.body, res.finalUrl), finalUrl: res.finalUrl };
    } catch (e) {
      if (e instanceof SafeFetchError) {
        return { error: e.kind === "blocked" ? `URL not allowed: ${e.message}` : `Could not fetch the URL: ${e.message}` };
      }
      throw e;
    }
    if (!page.title || page.text.length < 80) {
      return { error: "Could not extract meaningful content from that page. Use manual entry instead." };
    }
    const res = await createIntelligence(db, {
      title: page.title,
      provider: input.provider,
      category: input.category,
      sourceUrl: page.canonicalUrl ?? page.finalUrl,
      publishedAt: page.publishedAt,
      rawContent: page.text,
      summary: page.description,
      entryMethod: "url_submission",
      createdBy: user.id,
    });
    if (res.status === "duplicate") {
      return {
        error: `Already tracked (${res.duplicate.reason.replace("_", " ")}): "${res.duplicate.title}".`,
        href: `/intelligence/${res.duplicate.id}`,
      };
    }
    if (res.status !== "created") return { error: "This article could not be saved." };
    id = res.id;
    await logActivity(db, { userId: user.id, action: "intelligence.create", entityType: "intelligence_item", entityId: id, metadata: { method: "url", url: input.url } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/intelligence");
  redirect(`/intelligence/${id}`);
}

export async function analyzeItem(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const id = z.string().uuid().parse(formData.get("id"));
    if (!isAiConfigured()) return { error: "ANTHROPIC_API_KEY is not configured on the server." };
    await assertWithinAiRateLimit(db, user.id);
    const res = await runAnalysis(db, id, user.id);
    revalidatePath(`/intelligence/${id}`);
    revalidatePath("/intelligence");
    return { ok: true, message: `Analysis complete — impact: ${res.impact}.` };
  } catch (e) {
    if (e instanceof RateLimitedError || e instanceof AnalysisError) return { error: e.message };
    return fail(e);
  }
}

export async function updateItemStatus(formData: FormData) {
  const { db, user } = await requireEditor();
  const id = z.string().uuid().parse(formData.get("id"));
  const status = z.enum(ITEM_STATUSES).parse(formData.get("status"));
  await db.from("intelligence_items").update({ status }).eq("id", id);
  await logActivity(db, { userId: user.id, action: "intelligence.status", entityType: "intelligence_item", entityId: id, metadata: { status } });
  revalidatePath(`/intelligence/${id}`);
}

export async function toggleBookmark(formData: FormData) {
  const { db, user } = await requireMember();
  const id = z.string().uuid().parse(formData.get("id"));
  const { data } = await db.from("bookmarks").select("id").eq("user_id", user.id).eq("intelligence_id", id).maybeSingle();
  if (data) await db.from("bookmarks").delete().eq("id", data.id);
  else await db.from("bookmarks").insert({ user_id: user.id, intelligence_id: id });
  revalidatePath(`/intelligence/${id}`);
  revalidatePath("/intelligence");
}

export async function setReadState(formData: FormData) {
  const { db, user } = await requireMember();
  const id = z.string().uuid().parse(formData.get("id"));
  const read = formData.get("read") === "1";
  if (read) await db.from("read_receipts").upsert({ user_id: user.id, intelligence_id: id });
  else await db.from("read_receipts").delete().eq("user_id", user.id).eq("intelligence_id", id);
  revalidatePath("/intelligence");
  revalidatePath(`/intelligence/${id}`);
}

export async function addNote(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireMember();
    const id = z.string().uuid().parse(formData.get("id"));
    const body = z.string().trim().min(1, "Note is empty").max(5000).parse(formData.get("body"));
    const { error } = await db.from("intelligence_notes").insert({ intelligence_id: id, author_id: user.id, body });
    if (error) return { error: error.message };
    revalidatePath(`/intelligence/${id}`);
    return { ok: true, message: "Note added." };
  } catch (e) {
    return fail(e);
  }
}

const TaskFromRec = z.object({
  intelligence_id: z.string().uuid(),
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().max(5000).optional(),
  department: z.string().trim().max(60).optional(),
  priority: z.enum(PRIORITIES),
  client_id: z.string().uuid().optional().or(z.literal("")),
});

export async function createTaskFromRecommendation(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const input = TaskFromRec.parse(Object.fromEntries(formData));
    const { data, error } = await db
      .from("actions")
      .insert({
        intelligence_id: input.intelligence_id,
        client_id: input.client_id || null,
        title: input.title,
        description: input.description ?? null,
        department: input.department ?? null,
        priority: input.priority,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    await db.from("intelligence_items").update({ status: "actioned" }).eq("id", input.intelligence_id).in("status", ["new", "reviewing"]);
    await logActivity(db, { userId: user.id, action: "action.create", entityType: "action", entityId: data.id, metadata: { from: "recommendation" } });
    revalidatePath(`/intelligence/${input.intelligence_id}`);
    revalidatePath("/actions");
    return { ok: true, message: "Task created in the Action Center.", href: `/actions/${data.id}` };
  } catch (e) {
    return fail(e);
  }
}

const ImpactSchema = z.object({
  intelligence_id: z.string().uuid(),
  client_id: z.string().uuid("Choose a client"),
  impact_reason: z.string().trim().min(3, "Explain why this client is affected").max(2000),
  recommended_action: z.string().trim().max(2000).optional(),
});

export async function linkClientImpact(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const input = ImpactSchema.parse(Object.fromEntries(formData));
    const { error } = await db.from("client_impacts").upsert(
      { ...input, recommended_action: input.recommended_action || null, origin: "manual", review_status: "confirmed", owner_id: user.id },
      { onConflict: "intelligence_id,client_id" },
    );
    if (error) return { error: error.message };
    revalidatePath(`/intelligence/${input.intelligence_id}`);
    return { ok: true, message: "Client association saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function updateImpactReview(formData: FormData) {
  const { db } = await requireEditor();
  const id = z.string().uuid().parse(formData.get("id"));
  const status = z.enum(["suggested", "confirmed", "in_review", "not_affected", "resolved"]).parse(formData.get("review_status"));
  const { data } = await db.from("client_impacts").update({ review_status: status }).eq("id", id).select("intelligence_id, client_id").single();
  if (data) {
    revalidatePath(`/intelligence/${data.intelligence_id}`);
    revalidatePath(`/clients/${data.client_id}`);
  }
}

/** Admin-only permanent delete of one intelligence record (analyses, notes, bookmarks, client links cascade; tasks are kept, unlinked). */
export async function deleteIntelligence(_: ActionState, formData: FormData): Promise<ActionState> {
  let title: string;
  try {
    const { db, user } = await requireAdmin();
    const id = z.string().uuid().parse(formData.get("id"));
    if (formData.get("confirm") !== "on") return { error: "Tick the confirmation box first." };
    const { data: item } = await db
      .from("intelligence_items")
      .select("canonical_url, content_fingerprint, title, provider, source_id")
      .eq("id", id)
      .maybeSingle();
    if (item) await writeTombstones(db, [item], "deleted", user.id);
    const { data, error } = await db.from("intelligence_items").delete().eq("id", id).select("id, title");
    if (error) return { error: error.message };
    if (!data?.length) return { error: "Nothing was deleted — administrator access is required." };
    title = data[0].title;
    await logActivity(db, { userId: user.id, action: "intelligence.delete", entityType: "intelligence_item", entityId: id, metadata: { title } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/intelligence");
  revalidatePath("/");
  redirect(`/intelligence?deleted=${encodeURIComponent(title.slice(0, 120))}`);
}

/**
 * Admin-only bulk delete of every article that has not been assessed by Claude
 * (impact "unassessed"), optionally for one provider. Records currently being
 * analysed are skipped. Deleted articles are remembered so automatic collection
 * does not import them again.
 */
export async function deleteUnassessed(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireAdmin();
    if (String(formData.get("confirm_text") ?? "").trim().toUpperCase() !== "DELETE") {
      return { error: "Type DELETE to confirm." };
    }
    const provider = String(formData.get("provider") ?? "");
    if (provider && !PROVIDER_KEYS.includes(provider)) return { error: "Unknown provider." };
    let q = db
      .from("intelligence_items")
      .select("id, canonical_url, content_fingerprint, title, provider, source_id")
      .eq("impact_level", "unassessed")
      .neq("analysis_status", "running")
      .limit(5000);
    if (provider) q = q.eq("provider", provider);
    const { data: rows, error } = await q;
    if (error) return { error: error.message };
    if (!rows?.length) return { ok: true, message: "There are no unassessed articles to delete." };

    const remembered = await writeTombstones(db, rows, "bulk_unassessed", user.id);
    let deleted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const ids = rows.slice(i, i + 200).map((r) => r.id);
      const { data, error: delErr } = await db.from("intelligence_items").delete().in("id", ids).select("id");
      if (delErr) return { error: `Deleted ${deleted} so far, then failed: ${delErr.message}` };
      deleted += data?.length ?? 0;
    }
    await logActivity(db, {
      userId: user.id, action: "intelligence.bulk_delete_unassessed", entityType: "intelligence_item",
      metadata: { deleted, provider: provider || "all", remembered },
    });
    revalidatePath("/intelligence");
    revalidatePath("/sources");
    revalidatePath("/");
    return {
      ok: true,
      message: `Deleted ${deleted} unassessed article(s).${remembered ? " They won't be collected again automatically." : " Warning: apply the latest database migration, otherwise active sources may collect them again."}`,
    };
  } catch (e) {
    return fail(e);
  }
}
