"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireEditor, AuthorizationError } from "@/lib/auth";
import { errorMessage, type ActionState } from "@/lib/action-state";
import { ACTION_STATUSES, DEPARTMENTS, PRIORITIES } from "@/lib/intel/taxonomy";
import { logActivity } from "@/lib/activity";

const opt = z.string().uuid().optional().or(z.literal(""));
const TaskSchema = z.object({
  title: z.string().trim().min(3, "Title is required").max(300),
  description: z.string().trim().max(10_000).optional(),
  department: z.enum(DEPARTMENTS).optional().or(z.literal("")),
  priority: z.enum(PRIORITIES),
  status: z.enum(ACTION_STATUSES).optional(),
  assigned_to: opt,
  client_id: opt,
  intelligence_id: opt,
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

function fail(e: unknown): ActionState {
  if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" · ") };
  if (e instanceof AuthorizationError) return { error: e.message };
  return { error: errorMessage(e) };
}

function toRow(input: z.infer<typeof TaskSchema>) {
  return {
    title: input.title,
    description: input.description || null,
    department: input.department || null,
    priority: input.priority,
    ...(input.status ? { status: input.status } : {}),
    assigned_to: input.assigned_to || null,
    client_id: input.client_id || null,
    intelligence_id: input.intelligence_id || null,
    due_date: input.due_date || null,
  };
}

export async function createTask(_: ActionState, formData: FormData): Promise<ActionState> {
  let id: string;
  try {
    const { db, user } = await requireEditor();
    const input = TaskSchema.parse(Object.fromEntries(formData));
    const { data, error } = await db.from("actions").insert({ ...toRow(input), created_by: user.id }).select("id").single();
    if (error) return { error: error.message };
    id = data.id;
    await logActivity(db, { userId: user.id, action: "action.create", entityType: "action", entityId: id });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/actions");
  redirect(`/actions/${id}`);
}

export async function updateTask(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const id = z.string().uuid().parse(formData.get("id"));
    const input = TaskSchema.parse(Object.fromEntries(formData));
    const { error } = await db.from("actions").update(toRow(input)).eq("id", id);
    if (error) return { error: error.message };
    await logActivity(db, { userId: user.id, action: "action.update", entityType: "action", entityId: id, metadata: { status: input.status } });
    revalidatePath(`/actions/${id}`);
    revalidatePath("/actions");
    return { ok: true, message: "Task updated." };
  } catch (e) {
    return fail(e);
  }
}

export async function setTaskStatus(formData: FormData) {
  const { db, user } = await requireEditor();
  const id = z.string().uuid().parse(formData.get("id"));
  const status = z.enum(ACTION_STATUSES).parse(formData.get("status"));
  await db.from("actions").update({ status }).eq("id", id);
  await logActivity(db, { userId: user.id, action: "action.status", entityType: "action", entityId: id, metadata: { status } });
  revalidatePath("/actions");
  revalidatePath(`/actions/${id}`);
}

export async function addComment(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const id = z.string().uuid().parse(formData.get("action_id"));
    const body = z.string().trim().min(1, "Comment is empty").max(5000).parse(formData.get("body"));
    const { error } = await db.from("action_comments").insert({ action_id: id, author_id: user.id, body });
    if (error) return { error: error.message };
    revalidatePath(`/actions/${id}`);
    return { ok: true, message: "Comment added." };
  } catch (e) {
    return fail(e);
  }
}
