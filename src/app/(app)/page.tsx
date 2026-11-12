import Link from "next/link";
import { AlertTriangle, Building2, ListChecks, Radar, ShieldAlert, Sparkles, Zap } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { PageHeader, StatCard, EmptyState } from "@/components/shared/page";
import { HealthBadge, SeverityBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarList } from "@/components/charts/bar-list";
import { categoryLabel, providerName } from "@/lib/intel/taxonomy";
import { signalScore } from "@/lib/intel/scoring";
import type { HealthStatus } from "@/lib/types";
import { daysAgoIso, formatDate, relativeTime, todayIsoDate, truncate } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { db, profile } = await requireMember();
  const since = daysAgoIso(90);
  const today = todayIsoDate();

  const [
    { count: totalCount }, { data: recent }, { data: impacts }, { data: actions },
    { data: findings }, { data: zones }, { data: latestAnalyses },
  ] = await Promise.all([
    db.from("intelligence_items").select("id", { count: "exact", head: true }),
    db.from("intelligence_items").select("id, title, provider, category, impact_level, status, published_at, discovered_at, summary").gte("discovered_at", since).order("discovered_at", { ascending: false }).limit(500),
    db.from("client_impacts").select("intelligence_id, client_id, review_status, clients(name)"),
    db.from("actions").select("id, title, intelligence_id, client_id, priority, status, due_date").in("status", ["open", "in_progress", "in_review"]),
    db.from("cloudflare_findings").select("id, zone_id, severity, title, last_seen_at, cloudflare_zones(domain, clients(name))").in("status", ["open", "acknowledged"]).in("severity", ["critical", "high"]).order("last_seen_at", { ascending: false }).limit(50),
    db.from("cloudflare_zones").select("id, domain, health_status, health_reason, clients(name)"),
    db.from("ai_analyses").select("id, intelligence_id, summary, impact_level, analyzed_at, confidence_score, intelligence_items(title)").eq("is_current", true).order("analyzed_at", { ascending: false }).limit(4),
  ]);

  const items = recent ?? [];
  const impactsByItem = new Map<string, number>();
  for (const i of impacts ?? []) impactsByItem.set(i.intelligence_id, (impactsByItem.get(i.intelligence_id) ?? 0) + 1);
  const actionsByItem = new Map<string, number>();
  for (const a of actions ?? []) if (a.intelligence_id) actionsByItem.set(a.intelligence_id, (actionsByItem.get(a.intelligence_id) ?? 0) + 1);

  const signals = items
    .map((it) => ({ it, score: signalScore(it, { clientImpacts: impactsByItem.get(it.id) ?? 0, openActions: actionsByItem.get(it.id) ?? 0 }) }))
    .filter((s) => s.score > 0 && !["archived", "dismissed"].includes(s.it.status))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const critical = items.filter((i) => i.impact_level === "critical").length;
  const high = items.filter((i) => i.impact_level === "high").length;
  const affectedClients = new Set((impacts ?? []).filter((i) => !["not_affected", "resolved"].includes(i.review_status)).map((i) => i.client_id));

  // Needs Attention: Cloudflare (Blend360 first) → critical unactioned intel → overdue / critical tasks → suggested client impacts.
  type Attention = { key: string; kind: string; severity: string; title: string; href: string; meta: string; rank: number };
  const attention: Attention[] = [];
  for (const f of findings ?? []) {
    const z = f.cloudflare_zones as unknown as { domain: string; clients: { name: string } | null } | null;
    const blend = /blend360/i.test(`${z?.clients?.name} ${z?.domain}`);
    attention.push({
      key: `f-${f.id}`, kind: "Cloudflare", severity: f.severity, title: f.title, href: `/cloudflare/zones/${f.zone_id}#findings`,
      meta: `${z?.domain ?? ""} · seen ${relativeTime(f.last_seen_at)}`, rank: (f.severity === "critical" ? 100 : 80) + (blend ? 15 : 0),
    });
  }
  for (const it of items.filter((i) => ["critical", "high"].includes(i.impact_level) && ["new", "reviewing"].includes(i.status) && !actionsByItem.has(i.id))) {
    attention.push({ key: `i-${it.id}`, kind: "Intelligence", severity: it.impact_level, title: it.title, href: `/intelligence/${it.id}`, meta: `${providerName(it.provider)} · no action yet`, rank: it.impact_level === "critical" ? 90 : 60 });
  }
  for (const a of actions ?? []) {
    const overdue = a.due_date && a.due_date < today;
    if (overdue || a.priority === "critical") {
      attention.push({ key: `a-${a.id}`, kind: "Task", severity: a.priority, title: a.title, href: `/actions/${a.id}`, meta: overdue ? `overdue since ${formatDate(a.due_date)}` : "critical priority", rank: overdue ? 70 : 65 });
    }
  }
  const suggested = (impacts ?? []).filter((i) => i.review_status === "suggested");
  if (suggested.length) {
    attention.push({ key: "impacts", kind: "Clients", severity: "medium", title: `${suggested.length} client impact suggestion(s) awaiting review`, href: "/analysis", meta: "AI / stack-match suggestions", rank: 40 });
  }
  attention.sort((a, b) => b.rank - a.rank);

  const count = <K extends string>(arr: { [k in K]: string }[], key: K, label: (v: string) => string) => {
    const m = new Map<string, number>();
    for (const r of arr) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
    return [...m.entries()].map(([k, v]) => ({ label: label(k), value: v })).sort((a, b) => b.value - a.value).slice(0, 8);
  };

  return (
    <>
      <PageHeader
        title={`Overview${profile.full_name ? ` — ${profile.full_name.split(" ")[0]}` : ""}`}
        description="Know what changes. Understand what matters. Act before it becomes a problem."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Intelligence" value={totalCount ?? 0} hint="all time" icon={Radar} />
        <StatCard label="Critical (90d)" value={critical} tone={critical ? "critical" : "default"} icon={ShieldAlert} />
        <StatCard label="High impact (90d)" value={high} tone={high ? "high" : "default"} icon={AlertTriangle} />
        <StatCard label="Pending actions" value={(actions ?? []).length} icon={ListChecks} />
        <StatCard label="Affected clients" value={affectedClients.size} icon={Building2} />
        <StatCard label="Cloudflare high+ findings" value={(findings ?? []).length} tone={(findings ?? []).length ? "critical" : "ok"} icon={Zap} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Signals That Matter</CardTitle>
            <p className="text-xs text-muted-foreground">Ranked by impact, client exposure and recency — not simply newest first.</p>
          </CardHeader>
          <CardContent>
            {!signals.length ? (
              <EmptyState icon={Sparkles} title="No assessed signals yet" description="Analyse intelligence records with Claude to populate this list." />
            ) : (
              <ol className="flex flex-col divide-y">
                {signals.map(({ it }) => (
                  <li key={it.id} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge level={it.impact_level} />
                      <Link href={`/intelligence/${it.id}`} className="text-sm font-medium hover:text-primary">{it.title}</Link>
                    </div>
                    {it.summary && <p className="mt-1 text-xs text-muted-foreground">{truncate(it.summary, 200)}</p>}
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                      <span>{providerName(it.provider)}</span><span>{categoryLabel(it.category)}</span>
                      <span>{formatDate(it.published_at ?? it.discovered_at)}</span>
                      {impactsByItem.get(it.id) ? <span className="text-blue-300">{impactsByItem.get(it.id)} client(s)</span> : null}
                      {actionsByItem.get(it.id) ? <span>{actionsByItem.get(it.id)} open task(s)</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2 border-sev-critical/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-rose-300" aria-hidden /> Needs Attention</CardTitle>
          </CardHeader>
          <CardContent>
            {!attention.length ? (
              <p className="text-xs text-muted-foreground">Nothing urgent. Cloudflare status only reflects checks that have actually run.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {attention.slice(0, 10).map((a) => (
                  <li key={a.key} className="flex items-start gap-2 py-2">
                    <SeverityBadge level={a.severity} />
                    <div className="min-w-0">
                      <Link href={a.href} className="text-xs font-medium hover:text-primary">{a.title}</Link>
                      <div className="text-[11px] text-muted-foreground"><Badge variant="outline" className="mr-1">{a.kind}</Badge>{a.meta}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Cloudflare Security &amp; AI Readiness</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!(zones ?? []).length && <p className="text-xs text-muted-foreground">No monitored zones. <Link className="text-primary" href="/cloudflare/setup">Register one</Link>.</p>}
            {zones?.map((z) => (
              <Link key={z.id} href={`/cloudflare/zones/${z.id}`} className="rounded-md border px-3 py-2 text-xs hover:bg-muted/40">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{z.domain}</span><HealthBadge status={z.health_status as HealthStatus} /></div>
                <div className="mt-0.5 text-muted-foreground">{[(z.clients as unknown as { name: string } | null)?.name, z.health_reason ?? "Not audited yet"].filter(Boolean).join(" · ")}</div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Intelligence by provider (90 days)</CardTitle></CardHeader>
          <CardContent><BarList title="Intelligence records by provider" data={count(items, "provider", providerName)} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Intelligence by category (90 days)</CardTitle></CardHeader>
          <CardContent><BarList title="Intelligence records by category" data={count(items, "category", categoryLabel)} /></CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Latest AI analysis</CardTitle></CardHeader>
          <CardContent>
            {!(latestAnalyses ?? []).length ? <p className="text-xs text-muted-foreground">No analyses yet.</p> : (
              <ul className="flex flex-col divide-y">
                {latestAnalyses!.map((a) => (
                  <li key={a.id} className="py-2 text-xs">
                    <div className="flex items-center gap-2"><SeverityBadge level={a.impact_level} /><Link className="font-medium hover:text-primary" href={`/intelligence/${a.intelligence_id}`}>{(a.intelligence_items as unknown as { title: string } | null)?.title}</Link></div>
                    <p className="mt-1 text-muted-foreground">{truncate(a.summary, 220)}</p>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{relativeTime(a.analyzed_at)} · confidence {Math.round(Number(a.confidence_score) * 100)}%</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent provider announcements</CardTitle></CardHeader>
          <CardContent>
            {!items.length ? <p className="text-xs text-muted-foreground">No intelligence collected in the last 90 days.</p> : (
              <ul className="flex flex-col divide-y">
                {items.slice(0, 8).map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                    <Link href={`/intelligence/${it.id}`} className="truncate hover:text-primary">{it.title}</Link>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{providerName(it.provider)} · {relativeTime(it.discovered_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
