"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireMember, AuthorizationError } from "@/lib/auth";
import { errorMessage, type ActionState } from "@/lib/action-state";
import { logActivity } from "@/lib/activity";

export async function setUserRole(formData: FormData) {
  const { db, user } = await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));
  const role = z.enum(["admin", "analyst", "viewer", "pending"]).parse(formData.get("role"));
  if (id === user.id && role !== "admin") throw new AuthorizationError("You cannot remove your own admin role.");
  const { error } = await db.from("profiles").update({ role }).eq("id", id);
  if (error) throw new Error(error.message);
  await logActivity(db, { userId: user.id, action: "user.role", entityType: "profile", entityId: id, metadata: { role } });
  revalidatePath("/settings");
}

export async function addAllowedDomain(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireAdmin();
    const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Enter a domain like example.com").parse(formData.get("domain"));
    const role = z.enum(["analyst", "viewer"]).parse(formData.get("default_role"));
    const { error } = await db.from("allowed_email_domains").upsert({ domain, default_role: role });
    if (error) return { error: error.message };
    await logActivity(db, { userId: user.id, action: "settings.domain.add", entityType: "allowed_email_domain", metadata: { domain, role } });
    revalidatePath("/settings");
    return { ok: true, message: `New sign-ups from @${domain} will receive the ${role} role.` };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: e.issues[0].message };
    return { error: errorMessage(e) };
  }
}

export async function removeAllowedDomain(formData: FormData) {
  const { db, user } = await requireAdmin();
  const domain = z.string().parse(formData.get("domain"));
  await db.from("allowed_email_domains").delete().eq("domain", domain);
  await logActivity(db, { userId: user.id, action: "settings.domain.remove", entityType: "allowed_email_domain", metadata: { domain } });
  revalidatePath("/settings");
}

export async function updateOwnName(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireMember();
    const name = z.string().trim().max(120).parse(formData.get("full_name"));
    const { error } = await db.from("profiles").update({ full_name: name || null }).eq("id", user.id);
    if (error) return { error: error.message };
    revalidatePath("/settings");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
