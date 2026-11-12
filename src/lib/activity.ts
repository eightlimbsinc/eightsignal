import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Append-only activity trail. Failures are logged, never thrown, so they can't break the action. */
export async function logActivity(
  db: SupabaseClient,
  entry: { userId: string | null; action: string; entityType: string; entityId?: string | null; metadata?: Record<string, unknown> },
) {
  const { error } = await db.from("activity_logs").insert({
    user_id: entry.userId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
  });
  if (error) console.error("[activity] failed to log", entry.action, error.message);
}
