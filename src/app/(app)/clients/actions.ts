"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAdmin, requireEditor, AuthorizationError } from "@/lib/auth";
import { errorMessage, type ActionState } from "@/lib/action-state";
import { splitList } from "@/lib/utils";
import { logActivity } from "@/lib/activity";

const ClientSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  website_url: z.string().trim().url("Website must be a valid URL").optional().or(z.literal("")),
  industry: z.string().trim().max(120).optional(),
  platform: z.string().trim().max(120).optional(),
  hosting_provider: z.string().trim().max(120).optional(),
  cdn_provider: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(10_000).optional(),
});

export async function saveClient(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const id = formData.get("id");
    const input = ClientSchema.parse(Object.fromEntries(formData));
    const row = {
      name: input.name,
      website_url: input.website_url || null,
      industry: input.industry || null,
      platform: input.platform || null,
      hosting_provider: input.hosting_provider || null,
      cdn_provider: input.cdn_provider || null,
      notes: input.notes || null,
      technology_stack: splitList(formData.get("technology_stack")),
      active_services: splitList(formData.get("active_services")),
    };
    const res = id
      ? await db.from("clients").update(row).eq("id", z.string().uuid().parse(id)).select("id").single()
      : await db.from("clients").insert({ ...row, created_by: user.id }).select("id").single();
    if (res.error) return { error: res.error.code === "23505" ? "A client with that name already exists." : res.error.message };
    await logActivity(db, { userId: user.id, action: id ? "client.update" : "client.create", entityType: "client", entityId: res.data.id });
    revalidatePath("/clients");
    revalidatePath(`/clients/${res.data.id}`);
    return { ok: true, message: id ? "Client updated." : "Client registered.", href: id ? undefined : `/clients/${res.data.id}` };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" · ") };
    if (e instanceof AuthorizationError) return { error: e.message };
    return { error: errorMessage(e) };
  }
}

/**
 * Permanently deletes a client (admins only; RLS also enforces this). Cascades to the
 * client's Cloudflare accounts, stored tokens, zones, audits, findings, snapshots,
 * access tests, incidents and client-impact links. Tasks are kept but unlinked.
 * Never touches Cloudflare itself.
 */
export async function deleteClient(_: ActionState, formData: FormData): Promise<ActionState> {
  let name: string;
  try {
    const { db, user } = await requireAdmin();
    const id = z.string().uuid().parse(formData.get("id"));
    const { data: client } = await db.from("clients").select("id, name").eq("id", id).maybeSingle();
    if (!client) return { error: "Client not found." };
    const typed = String(formData.get("confirm_name") ?? "").trim();
    if (typed !== client.name) return { error: `Type the client name exactly ("${client.name}") to confirm.` };
    const { data: deleted, error } = await db.from("clients").delete().eq("id", id).select("id");
    if (error) return { error: error.message };
    if (!deleted?.length) return { error: "Nothing was deleted — administrator access is required." };
    await logActivity(db, { userId: user.id, action: "client.delete", entityType: "client", entityId: id, metadata: { name: client.name } });
    name = client.name;
  } catch (e) {
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" · ") };
    if (e instanceof AuthorizationError) return { error: e.message };
    return { error: errorMessage(e) };
  }
  revalidatePath("/clients");
  revalidatePath("/cloudflare");
  revalidatePath("/");
  redirect(`/clients?deleted=${encodeURIComponent(name)}`);
}
