import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader, EmptyState, StatCard } from "@/components/shared/page";
import { SeverityBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { BarList } from "@/components/charts/bar-list";
import { DEPARTMENTS, IMPACT_LEVELS, providerName } from "@/lib/intel/taxonomy";
import type { AiAnalysis, RecommendedAction } from "@/lib/types";
import { relativeTime, truncate } from "@/lib/utils";
import { updateImpactReview } from "../intelligence/actions";

export const metadata = { title: "Impact Analysis" };

export default async function AnalysisPage({ searchParams }: PageProps<"/analysis">) {
  const { db, profile } = await requireMember();
  const editor = canEdit(profile);
  const sp = await searchParams;
  const department = typeof sp.department === "string" ? sp.department : "";
  const impact = typeof sp.impact === "string" ? sp.impact : "";

  let q = db
    .from("ai_analyses")
    .select("*, intelligence_items(id, title, provider, status)")
    .eq("is_current", true)
    .order("analyzed_at", { ascending: false })
    .limit(100);
  if (department) q = q.contains("departments", [department]);
  if (impact) q = q.eq("impact_level", impact);
  const [{ data: analyses }, { data: suggestions }] = await Promise.all([
    q,
    db.from("client_impacts").select("id, impact_reason, recommended_action, origin, clients(id, name), intelligence_items(id, title, impact_level)").eq("review_status", "suggested").order("created_at", { ascending: false }).limit(30),
  ]);
  const list = (analyses ?? []) as (AiAnalysis & { intelligence_items: { id: string; title: string; provider: string; status: string } })[];
  const deptCounts = DEPARTMENTS.map((d) => ({ label: d, value: list.filter((a) => a.departments.includes(d)).length })).filter((d) => d.value);
  const allRecs = list.flatMap((a) => a.recommended_actions.map((r: RecommendedAction) => ({ ...r, item: a.intelligence_items, impact: a.impact_level })));
  const avgConfidence = list.length ? Math.round((list.reduce((s, a) => s + Number(a.confidence_score), 0) / list.length) * 100) : 0;
  const speculative = list.filter((a) => ["speculation", "prediction", "commentary"].includes(a.source_classification)).length;

  return (
    <>
      <PageHeader title="Impact Analysis" description="Claude's structured assessments across all intelligence: who is affected, risks, opportunities and recommended actions." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Analysed records" value={list.length} />
        <StatCard label="Recommendations" value={allRecs.length} />
        <StatCard label="Avg. confidence" value={`${avgConfidence}%`} />
        <StatCard label="Commentary / speculation" value={speculative} hint="not verified announcements" />
      </div>
      <form className="mb-4 flex flex-wrap gap-2" aria-label="Filter analyses">
        <Select name="department" defaultValue={department} className="w-44" aria-label="Department">
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
        </Select>
        <Select name="impact" defaultValue={impact} className="w-36" aria-label="Impact">
          <option value="">All impact</option>
          {IMPACT_LEVELS.map((i) => <option key={i}>{i}</option>)}
        </Select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          {!list.length ? (
            <EmptyState icon={Sparkles} title="No analyses" description="Open an intelligence record and run “Analyse with Claude”." />
          ) : list.map((a) => (
            <Card key={a.id}>
              <CardContent className="pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge level={a.impact_level} />
                  <Link href={`/intelligence/${a.intelligence_items.id}`} className="text-sm font-medium hover:text-primary">{a.intelligence_items.title}</Link>
                </div>
                <p className="mt-1.5 text-xs text-foreground/90">{a.summary}</p>
                <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
                  <div><div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-300/80">Risk</div><p className="text-muted-foreground">{truncate(a.risk_assessment, 260)}</p></div>
                  <div><div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-green-300/80">Opportunity</div><p className="text-muted-foreground">{truncate(a.opportunity_assessment, 260)}</p></div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  {a.departments.map((d) => <Badge key={d} variant="secondary">{d}</Badge>)}
                  <span>{providerName(a.intelligence_items.provider)} · {a.recommended_actions.length} action(s) · confidence {Math.round(Number(a.confidence_score) * 100)}% · {relativeTime(a.analyzed_at)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Analyses by department</CardTitle></CardHeader>
            <CardContent><BarList title="Analyses by department" data={deptCounts} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Client impact suggestions</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!(suggestions ?? []).length && <p className="text-xs text-muted-foreground">No suggestions awaiting review.</p>}
              {suggestions?.map((s) => {
                const c = s.clients as unknown as { id: string; name: string };
                const it = s.intelligence_items as unknown as { id: string; title: string; impact_level: string };
                return (
                  <div key={s.id} className="rounded-md border px-3 py-2 text-xs">
                    <div className="flex items-center gap-2"><SeverityBadge level={it.impact_level} /><Link href={`/clients/${c.id}`} className="font-medium hover:text-primary">{c.name}</Link><Badge variant="outline">{s.origin}</Badge></div>
                    <Link href={`/intelligence/${it.id}`} className="mt-1 block text-muted-foreground hover:text-foreground">{it.title}</Link>
                    <p className="mt-1">{s.impact_reason}</p>
                    {editor && (
                      <div className="mt-2 flex gap-1">
                        {(["confirmed", "not_affected"] as const).map((st) => (
                          <form key={st} action={updateImpactReview}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="review_status" value={st} />
                            <Button size="sm" variant={st === "confirmed" ? "secondary" : "ghost"} type="submit">{st === "confirmed" ? "Confirm" : "Not affected"}</Button>
                          </form>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
