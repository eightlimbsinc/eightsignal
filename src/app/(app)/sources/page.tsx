import { Rss } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PROVIDERS, providerName } from "@/lib/intel/taxonomy";
import { formatDate, relativeTime } from "@/lib/utils";
import { toggleSource } from "./actions";
import { ReprocessForm, RunNowForm, SourceForm } from "./forms";

export const metadata = { title: "Sources" };

export default async function SourcesPage() {
  const { db, profile } = await requireMember();
  const editor = canEdit(profile);
  const [{ data: sources }, { data: logs }, { count: pending }] = await Promise.all([
    db.from("sources").select("*").order("provider").order("name"),
    db.from("ingestion_logs").select("*, sources(name)").order("started_at", { ascending: false }).limit(30),
    db.from("intelligence_items").select("id", { count: "exact", head: true }).in("analysis_status", ["pending", "failed"]),
  ]);
  return (
    <>
      <PageHeader
        title="Sources"
        description="Official feeds and pages EightSignal collects from. Scheduled collection runs via a Netlify Scheduled Function; unreachable sources are logged, never filled with fabricated records."
        actions={editor && <ReprocessForm />}
      />
      <p className="mb-3 text-xs text-muted-foreground">{pending ?? 0} record(s) awaiting or failed analysis.</p>
      {!(sources ?? []).length ? (
        <EmptyState icon={Rss} title="No sources" description="Add official RSS/Atom feeds or changelog pages below." />
      ) : (
        <Card>
          <Table>
            <THead><TR className="hover:bg-transparent"><TH>Source</TH><TH>Type</TH><TH>Status</TH><TH>Last check</TH><TH>Last success</TH><TH>Last error</TH><TH /></TR></THead>
            <TBody>
              {sources!.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <div className="font-medium">{s.name}</div>
                    <div className="max-w-80 truncate text-[11px] text-muted-foreground" title={s.source_url}>{providerName(s.provider)} · {s.source_url}</div>
                    {s.notes && <div className="text-[11px] text-muted-foreground/80">{s.notes}</div>}
                  </TD>
                  <TD className="text-xs">{s.source_type.replace("_", " ")}<div className="text-[11px] text-muted-foreground">every {s.check_interval_minutes}m</div></TD>
                  <TD>
                    <StatusBadge status={s.is_active ? "active" : "inactive"} />
                    {s.consecutive_failures > 0 && <div className="mt-1 text-[11px] text-rose-300">{s.consecutive_failures} failure(s) · backing off</div>}
                  </TD>
                  <TD className="text-xs text-muted-foreground">{relativeTime(s.last_checked_at)}</TD>
                  <TD className="text-xs text-muted-foreground">{relativeTime(s.last_success_at)}</TD>
                  <TD className="max-w-60 text-[11px] text-rose-300">{s.last_error}</TD>
                  <TD>
                    {editor && (
                      <div className="flex flex-col items-start gap-1">
                        <RunNowForm id={s.id} />
                        <form action={toggleSource}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="active" value={s.is_active ? "0" : "1"} />
                          <Button size="sm" variant="ghost" type="submit">{s.is_active ? "Deactivate" : "Activate"}</Button>
                        </form>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Collection history</CardTitle></CardHeader>
          <CardContent>
            {!(logs ?? []).length ? <p className="text-xs text-muted-foreground">No collection runs yet.</p> : (
              <Table>
                <THead><TR className="hover:bg-transparent"><TH>Source</TH><TH>Status</TH><TH>Found</TH><TH>New</TH><TH>Dupes</TH><TH>Started</TH></TR></THead>
                <TBody>
                  {logs!.map((l) => (
                    <TR key={l.id}>
                      <TD className="text-xs">{(l.sources as { name: string } | null)?.name}<div className="text-[11px] text-muted-foreground">{l.trigger}</div>{l.error_message && <div className="max-w-64 text-[11px] text-rose-300">{l.error_message}</div>}</TD>
                      <TD><StatusBadge status={l.status} /></TD>
                      <TD className="tabular-nums text-xs">{l.records_found}</TD>
                      <TD className="tabular-nums text-xs">{l.records_created}</TD>
                      <TD className="tabular-nums text-xs">{l.records_duplicate}</TD>
                      <TD className="text-xs text-muted-foreground">{formatDate(l.started_at, true)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Provider registry</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {PROVIDERS.filter((p) => p.key !== "other").map((p) => (
                <li key={p.key} className="rounded-md border px-3 py-2 text-xs">
                  <div className="flex items-center justify-between"><span className="font-medium">{p.name}</span><StatusBadge status={p.status === "active" ? "active" : "planned"} /></div>
                  {p.focus.length > 0 && <p className="mt-1 text-muted-foreground">{p.focus.slice(0, 5).join(" · ")}{p.focus.length > 5 ? " …" : ""}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {editor && (
        <Card className="mt-5">
          <CardHeader><CardTitle>Add source</CardTitle></CardHeader>
          <CardContent><SourceForm /></CardContent>
        </Card>
      )}
    </>
  );
}
