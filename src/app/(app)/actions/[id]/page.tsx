import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page";
import { SeverityBadge, StatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { CommentForm, TaskForm } from "../task-form";

export default async function TaskPage({ params }: PageProps<"/actions/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, profile } = await requireMember();
  const { data: task } = await db
    .from("actions")
    .select("*, clients(id, name), intelligence_items(id, title), cloudflare_findings(id, zone_id, title, severity)")
    .eq("id", id)
    .maybeSingle();
  if (!task) notFound();
  const [{ data: comments }, { data: people }, { data: clients }, { data: intel }] = await Promise.all([
    db.from("action_comments").select("id, body, created_at, profiles(email, full_name)").eq("action_id", id).order("created_at"),
    db.from("profiles").select("id, email, full_name").neq("role", "pending").order("email"),
    db.from("clients").select("id, name").order("name"),
    db.from("intelligence_items").select("id, title").order("discovered_at", { ascending: false }).limit(100),
  ]);
  const intelItem = task.intelligence_items as { id: string; title: string } | null;
  const finding = task.cloudflare_findings as { id: string; zone_id: string; title: string; severity: string } | null;
  const intelOpts = (intel ?? []).map((i) => ({ id: i.id, name: i.title.slice(0, 90) }));
  if (intelItem && !intelOpts.some((o) => o.id === intelItem.id)) intelOpts.unshift({ id: intelItem.id, name: intelItem.title.slice(0, 90) });

  return (
    <>
      <Link href="/actions" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" /> Action Center</Link>
      <PageHeader
        title={task.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge level={task.priority} /> <StatusBadge status={task.status} />
            <span>Created {formatDate(task.created_at, true)}{task.completed_at ? ` · completed ${formatDate(task.completed_at, true)}` : ""}</span>
          </span>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            {canEdit(profile) ? (
              <TaskForm
                task={task}
                people={(people ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email }))}
                clients={clients ?? []}
                intelligence={intelOpts}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm">{task.description}</p>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Linked records</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-xs">
              {intelItem && <Link className="text-primary hover:underline" href={`/intelligence/${intelItem.id}`}>Intelligence: {intelItem.title}</Link>}
              {finding && <Link className="text-primary hover:underline" href={`/cloudflare/zones/${finding.zone_id}#findings`}>Cloudflare finding: {finding.title}</Link>}
              {(task.clients as { id: string; name: string } | null) && <Link className="text-primary hover:underline" href={`/clients/${(task.clients as { id: string }).id}`}>Client: {(task.clients as { name: string }).name}</Link>}
              {!intelItem && !finding && !task.clients && <span className="text-muted-foreground">None</span>}
              <span className="mt-2 text-[11px] text-muted-foreground">ClickUp: {task.external_ref ?? "not synced (manual export only)"}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Comments</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {(comments ?? []).map((c) => {
                const p = c.profiles as unknown as { email: string; full_name: string | null } | null;
                return (
                  <div key={c.id} className="text-xs">
                    <div className="text-muted-foreground">{p?.full_name ?? p?.email} · {formatDate(c.created_at, true)}</div>
                    <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
                  </div>
                );
              })}
              {!(comments ?? []).length && <p className="text-xs text-muted-foreground">No comments.</p>}
              {canEdit(profile) && <CommentForm actionId={id} />}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
