"use client";

import { useActionState } from "react";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/shared/page";
import { ActionForm, FormMessage, SubmitButton } from "@/components/shared/form";
import { ACTION_STATUSES, ACTION_STATUS_LABEL, DEPARTMENTS, PRIORITIES } from "@/lib/intel/taxonomy";
import { addComment, createTask, updateTask } from "./actions";

type Opt = { id: string; name: string };
export interface TaskValues {
  id?: string;
  title?: string;
  description?: string | null;
  department?: string | null;
  priority?: string;
  status?: string;
  assigned_to?: string | null;
  client_id?: string | null;
  intelligence_id?: string | null;
  due_date?: string | null;
}

export function TaskForm({ task, people, clients, intelligence }: { task?: TaskValues; people: Opt[]; clients: Opt[]; intelligence: Opt[] }) {
  const [state, action] = useActionState(task?.id ? updateTask : createTask, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {task?.id && <input type="hidden" name="id" value={task.id} />}
      <div className="sm:col-span-2"><Field label="Title" htmlFor="t-title"><Input id="t-title" name="title" required defaultValue={task?.title} /></Field></div>
      <div className="sm:col-span-2"><Field label="Description" htmlFor="t-desc"><Textarea id="t-desc" name="description" rows={4} defaultValue={task?.description ?? ""} /></Field></div>
      <Field label="Priority" htmlFor="t-pri">
        <Select id="t-pri" name="priority" defaultValue={task?.priority ?? "medium"}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select>
      </Field>
      {task?.id && (
        <Field label="Status" htmlFor="t-status">
          <Select id="t-status" name="status" defaultValue={task.status}>{ACTION_STATUSES.map((s) => <option key={s} value={s}>{ACTION_STATUS_LABEL[s]}</option>)}</Select>
        </Field>
      )}
      <Field label="Department" htmlFor="t-dept">
        <Select id="t-dept" name="department" defaultValue={task?.department ?? ""}><option value="">—</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select>
      </Field>
      <Field label="Assignee" htmlFor="t-assignee">
        <Select id="t-assignee" name="assigned_to" defaultValue={task?.assigned_to ?? ""}><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      </Field>
      <Field label="Due date" htmlFor="t-due"><Input id="t-due" type="date" name="due_date" defaultValue={task?.due_date ?? ""} /></Field>
      <Field label="Client" htmlFor="t-client">
        <Select id="t-client" name="client_id" defaultValue={task?.client_id ?? ""}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </Field>
      <Field label="Intelligence record" htmlFor="t-intel">
        <Select id="t-intel" name="intelligence_id" defaultValue={task?.intelligence_id ?? ""}><option value="">—</option>{intelligence.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <SubmitButton size="sm">{task?.id ? "Save changes" : "Create task"}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function CommentForm({ actionId }: { actionId: string }) {
  return (
    <ActionForm action={addComment} resetOnSuccess className="gap-2">
      <input type="hidden" name="action_id" value={actionId} />
      <Textarea name="body" rows={2} required placeholder="Add a comment…" aria-label="Comment" />
      <SubmitButton size="sm" variant="secondary">Comment</SubmitButton>
    </ActionForm>
  );
}
