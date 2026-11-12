import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Current user + profile, memoised per request. */
export const getSession = cache(async () => {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { db, user: null, profile: null as Profile | null };
  const { data: profile } = await db
    .from("profiles")
    .select("id, email, full_name, role, created_at")
    .eq("id", user.id)
    .maybeSingle();
  return { db, user, profile: (profile as Profile | null) ?? null };
});

/** For pages: redirect anonymous users to login and unapproved users to the pending screen. */
export async function requireMember() {
  const s = await getSession();
  if (!s.user) redirect("/login");
  if (!s.profile || s.profile.role === "pending") redirect("/pending");
  return { db: s.db, user: s.user, profile: s.profile };
}

export class AuthorizationError extends Error {}

/** For server actions / route handlers that mutate data. */
export async function requireEditor() {
  const s = await getSession();
  if (!s.user || !s.profile) throw new AuthorizationError("You must be signed in.");
  if (s.profile.role !== "admin" && s.profile.role !== "analyst") {
    throw new AuthorizationError("Your role does not allow changes. Ask an administrator for analyst access.");
  }
  return { db: s.db, user: s.user, profile: s.profile };
}

export async function requireAdmin() {
  const s = await requireEditor();
  if (s.profile.role !== "admin") throw new AuthorizationError("Administrator access required.");
  return s;
}

export function canEdit(profile: Profile | null) {
  return profile?.role === "admin" || profile?.role === "analyst";
}
