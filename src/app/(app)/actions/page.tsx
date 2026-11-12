import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader, EmptyState, StatCard } from "@/components/shared/page";
import { SeverityBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ACTION_STATUSES, ACTION_STATUS_LABEL, PRIORITIES, type ActionStatus } from "@/lib/intel/taxonomy";
import { formatDate } from "@/lib/utils";
import { setTaskStatus } from "./actions";
import { TaskForm } from "./task-form";

export const metadata = { title: "Action Center" };

function s(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

export default async function ActionsPage({ searchParams }: PageProps<"/actions">) {
  const { db, user, profile } = await requireMember();
  const editor = canEdit(profile);
  const sp = await searchParams;
  const status = s(sp.status);
  const priority = s(sp.priority);
  const mine = s(sp.mine) === "1";
  const includeClosed = s(sp.closed) === "1";

  let q = db
    .from("actions")
    .select("id, title, priority, status, due_date, department, created_at, assigned_to, clients(name), intelligence_items(title), assignee:profiles!actions_assigned_to_fkey(email, full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) q = q.eq("status", status);
  else if (!includeClosed) q = q.in("status", ["open", "in_progress", "in_review"]);
  if (priority) q = q.eq("priority", priority);
  if (mine) q = q.eq("assigned_to", user.id);
  const [{ data: tasks, error }, { data: counts }, { data: people }, { data: clients }, { data: intel }] = await Promise.all([
    q,
    db.from("actions").select("status, priority, due_date"),
    db.from("profiles").select("id, email, full_name").neq("role", "pending").order("email"),
    db.from("clients").select("id, name").order("name"),
    db.from("intelligence_items").select("id, title").order("discovered_at", { ascending: false }).limit(100),
  ]);
  if (error) throw new Error(error.message);
  const today = new Date().toISOString().slice(0, 10);
  const open = (counts ?? []).filter((c) => ["open", "in_progress", "in_review"].includes(c.status));
  const overdue = open.filter((c) => c.due_date && c.due_date < today).length;
  const order = (p: string) => PRIORITIES.indexOf(p as never);

  return (
    <>
      <PageHeader title="Action Center" description="Operational tasks generated from intelligence and Cloudflare findings. External ClickUp/Slack sync is not enabled — nothing leaves EightSignal without explicit authorization." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open" value={open.filter((c) => c.status === "open").length} />
        <StatCard label="In progress / review" value={open.filter((c) => c.status !== "open").length} />
        <StatCard label="Critical / high open" value={open.filter((c) => ["critical", "high"].includes(c.priority)).length} tone="high" />
        <StatCard label="Overdue" value={overdue} tone={overdue ? "critical" : "default"} />
      </div>

      <form className="mb-3 flex flex-wrap gap-2" aria-label="Filter tasks">
        <Select name="status" defaultValue={status} className="w-40" aria-label="Status">
          <option value="">Active</option>
          {ACTION_STATUSES.map((st) => <option key={st} value={st}>{ACTION_STATUS_LABEL[st]}</option>)}
        </Select>
        <Select name="priority" defaultValue={priority} className="w-36" aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" name="mine" value="1" defaultChecked={mine} /> Assigned to me</label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" name="closed" value="1" defaultChecked={includeClosed} /> Include completed/dismissed</label>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>

      {!tasks?.length ? (
        <EmptyState icon={ListChecks} title="No tasks match" description="Create tasks from AI recommendations, Cloudflare findings, or manually below." />
      ) : (
        <Card>
          <Table>
            <THead><TR className="hover:bg-transparent"><TH>Task</TH><TH>Priority</TH><TH>Status</TH><TH>Assignee</TH><TH>Client</TH><TH>Due</TH></TR></THead>
            <TBody>
              {[...tasks].sort((a, b) => order(a.priority) - order(b.priority)).map((t) => {
                const assignee = t.assignee as unknown as { email: string; full_name: string | null } | null;
                const overdueRow = t.due_date && t.due_date < today && !["completed", "dismissed"].includes(t.status);
                return (
                  <TR key={t.id}>
                    <TD>
                      <Link href={`/actions/${t.id}`} className="font-medium hover:text-primary">{t.title}</Link>
                      <div className="text-[11px] text-muted-foreground">{t.department ?? ""}{(t.intelligence_items as unknown as { title: string } | null)?.title ? ` · ${(t.intelligence_items as unknown as { title: string }).title}` : ""}</div>
                    </TD>
                    <TD><SeverityBadge level={t.priority} /></TD>
                    <TD>
                      {editor ? (
                        <form action={setTaskStatus} className="flex gap-1">
                          <input type="hidden" name="id" value={t.id} />
                          <Select name="status" defaultValue={t.status} className="h-8 w-32 text-xs" aria-label="Status">
                            {ACTION_STATUSES.map((st) => <option key={st} value={st}>{ACTION_STATUS_LABEL[st as ActionStatus]}</option>)}
                          </Select>
                          <Button size="sm" variant="ghost" type="submit">Set</Button>
                        </form>
                      ) : ACTION_STATUS_LABEL[t.status as ActionStatus]}
                    </TD>
                    <TD className="text-xs text-muted-foreground">{assignee?.full_name ?? assignee?.email ?? "—"}</TD>
                    <TD className="text-xs text-muted-foreground">{(t.clients as unknown as { name: string } | null)?.name ?? "—"}</TD>
                    <TD className={`text-xs ${overdueRow ? "text-rose-300" : "text-muted-foreground"}`}>{formatDate(t.due_date)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}

      {editor && (
        <Card className="mt-5">
          <CardHeader><CardTitle>New task</CardTitle></CardHeader>
          <CardContent>
            <TaskForm
              people={(people ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email }))}
              clients={clients ?? []}
              intelligence={(intel ?? []).map((i) => ({ id: i.id, name: i.title.slice(0, 90) }))}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
