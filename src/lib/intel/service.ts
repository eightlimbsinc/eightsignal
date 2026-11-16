import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "@/lib/utils";
import { canonicalizeUrl, contentFingerprint } from "./normalize";

export interface NewIntelligence {
  title: string;
  provider: string;
  category: string;
  sourceUrl?: string | null;
  publishedAt?: string | null;
  rawContent?: string | null;
  summary?: string | null;
  sourceId?: string | null;
  entryMethod: "manual" | "url_submission" | "ingestion";
  createdBy?: string | null;
}

export interface DuplicateMatch {
  id: string;
  title: string;
  reason: "canonical_url" | "content_fingerprint";
}

export async function findDuplicate(
  db: SupabaseClient,
  canonicalUrl: string | null,
  fingerprint: string,
): Promise<DuplicateMatch | null> {
  if (canonicalUrl) {
    const { data } = await db.from("intelligence_items").select("id, title").eq("canonical_url", canonicalUrl).maybeSingle();
    if (data) return { ...data, reason: "canonical_url" };
  }
  const { data } = await db.from("intelligence_items").select("id, title").eq("content_fingerprint", fingerprint).maybeSingle();
  if (data) return { ...data, reason: "content_fingerprint" };
  return null;
}

export type CreateResult =
  | { status: "created"; id: string; slug: string }
  | { status: "duplicate"; duplicate: DuplicateMatch }
  | { status: "suppressed" }; // previously deleted by an admin; skipped by automatic collection

/**
 * True when an admin deleted this article before. Only automatic ingestion honours
 * tombstones; a person can still re-add a deleted article manually. If the table is
 * missing (migration not applied yet) this fails open so ingestion keeps working.
 */
export async function isTombstoned(db: SupabaseClient, canonicalUrl: string | null, fingerprint: string): Promise<boolean> {
  const filters = [`content_fingerprint.eq.${fingerprint}`];
  if (canonicalUrl) filters.push(`canonical_url.eq."${canonicalUrl.replace(/"/g, '\\"')}"`);
  const { data, error } = await db.from("intelligence_tombstones").select("id").or(filters.join(",")).limit(1);
  if (error) {
    console.warn("[intel] tombstone check skipped:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export interface TombstoneInput {
  canonical_url: string | null;
  content_fingerprint: string;
  title: string;
  provider: string;
  source_id: string | null;
}

/** Records deleted articles. Returns false (with a logged warning) if the table is missing. */
export async function writeTombstones(
  db: SupabaseClient,
  rows: TombstoneInput[],
  reason: "deleted" | "bulk_unassessed" | "source_deleted",
  userId: string,
): Promise<boolean> {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, title: r.title.slice(0, 300), reason, deleted_by: userId }));
    const { error } = await db.from("intelligence_tombstones").insert(chunk);
    if (error) {
      console.warn("[intel] could not write tombstones:", error.message);
      return false;
    }
  }
  return true;
}

/** Inserts a record after duplicate detection; DB unique indexes are the final guard. */
export async function createIntelligence(db: SupabaseClient, input: NewIntelligence): Promise<CreateResult> {
  const canonical = input.sourceUrl ? canonicalizeUrl(input.sourceUrl) : null;
  const fingerprint = contentFingerprint(input.title, input.rawContent ?? input.summary ?? "");
  const dup = await findDuplicate(db, canonical, fingerprint);
  if (dup) return { status: "duplicate", duplicate: dup };
  if (input.entryMethod === "ingestion" && (await isTombstoned(db, canonical, fingerprint))) {
    return { status: "suppressed" };
  }

  const base = slugify(input.title);
  const slug = `${base}-${fingerprint.slice(0, 6)}`;
  const { data, error } = await db
    .from("intelligence_items")
    .insert({
      title: input.title.trim().slice(0, 500),
      slug,
      provider: input.provider,
      category: input.category,
      source_id: input.sourceId ?? null,
      source_url: input.sourceUrl ?? null,
      canonical_url: canonical,
      published_at: input.publishedAt ?? null,
      raw_content: input.rawContent ?? null,
      summary: input.summary ?? null,
      entry_method: input.entryMethod,
      content_fingerprint: fingerprint,
      created_by: input.createdBy ?? null,
    })
    .select("id, slug")
    .single();
  if (error) {
    if (error.code === "23505") {
      const again = await findDuplicate(db, canonical, fingerprint);
      if (again) return { status: "duplicate", duplicate: again };
    }
    throw new Error(error.message);
  }
  return { status: "created", id: data.id, slug: data.slug };
}
