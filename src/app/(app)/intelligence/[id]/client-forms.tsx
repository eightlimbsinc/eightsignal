"use client";

import { useActionState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { Input, Select, Textarea } from "@/components/ui/input";
import { ActionForm, FormMessage, SubmitButton } from "@/components/shared/form";
import { DEPARTMENTS, PRIORITIES } from "@/lib/intel/taxonomy";
import { addNote, analyzeItem, createTaskFromRecommendation, deleteIntelligence, linkClientImpact } from "../actions";

export function AnalyzeButton({ id, label }: { id: string; label: string }) {
  const [state, action] = useActionState(analyzeItem, {});
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" pendingLabel="Analysing with Claude… (can take ~30s)">
        <Sparkles /> {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function TaskFromRecommendation({
  intelligenceId,
  rec,
  clients,
}: {
  intelligenceId: string;
  rec: { title: string; description: string; department: string; priority: string };
  clients: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(createTaskFromRecommendation, {});
  return (
    <details className="group mt-2">
      <summary className="cursor-pointer text-xs text-primary hover:underline">Create task</summary>
      <form action={action} className="mt-2 grid gap-2 rounded-md border bg-muted/30 p-3">
        <input type="hidden" name="intelligence_id" value={intelligenceId} />
        <Input name="title" defaultValue={rec.title} required aria-label="Task title" />
        <Textarea name="description" defaultValue={rec.description} rows={2} aria-label="Description" />
        <div className="grid grid-cols-3 gap-2">
          <Select name="department" defaultValue={rec.department} aria-label="Department">
            {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          </Select>
          <Select name="priority" defaultValue={rec.priority} aria-label="Priority">
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Select name="client_id" defaultValue="" aria-label="Client">
            <option value="">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <SubmitButton size="sm" pendingLabel="Creating…">Create task</SubmitButton>
        <FormMessage state={state} />
      </form>
    </details>
  );
}

export function NoteForm({ id }: { id: string }) {
  return (
    <ActionForm action={addNote} resetOnSuccess className="gap-2">
      <input type="hidden" name="id" value={id} />
      <Textarea name="body" rows={2} placeholder="Add an internal note…" required aria-label="Internal note" />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Add note</SubmitButton>
    </ActionForm>
  );
}

export function LinkClientForm({ id, clients }: { id: string; clients: { id: string; name: string }[] }) {
  const [state, action] = useActionState(linkClientImpact, {});
  return (
    <details>
      <summary className="cursor-pointer text-xs text-primary hover:underline">Associate a client</summary>
      <form action={action} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="intelligence_id" value={id} />
        <Select name="client_id" required defaultValue="" aria-label="Client">
          <option value="" disabled>Choose client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Textarea name="impact_reason" rows={2} placeholder="Why is this client affected?" required aria-label="Impact reason" />
        <Input name="recommended_action" placeholder="Recommended action (optional)" aria-label="Recommended action" />
        <SubmitButton size="sm" variant="secondary">Save association</SubmitButton>
        <FormMessage state={state} />
      </form>
    </details>
  );
}

export function DeleteIntelligenceForm({ id, fromSource }: { id: string; fromSource: boolean }) {
  const [state, action] = useActionState(deleteIntelligence, {});
  return (
    <details>
      <summary className="cursor-pointer text-xs text-rose-300 hover:underline">Delete this article…</summary>
      <form action={action} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <p className="text-xs text-muted-foreground">
          Permanently removes the article with its AI analyses, notes, bookmarks and client links. Tasks created from it are kept.
          {fromSource && " Its source is still active, so this article may be collected again on the next run — deactivate or delete the source to prevent that."}
        </p>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" required /> I understand this cannot be undone</label>
        <SubmitButton size="sm" variant="destructive" pendingLabel="Deleting…"><Trash2 /> Delete article</SubmitButton>
        <FormMessage state={state} />
      </form>
    </details>
  );
}
