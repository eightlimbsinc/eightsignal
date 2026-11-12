import Link from "next/link";
import { AlertTriangle, Globe, KeyRound, ListChecks, Plus, ShieldCheck, ShieldAlert, Siren } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader, EmptyState, StatCard, SectionTitle } from "@/components/shared/page";
import { HealthBadge, SeverityBadge, StatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CRAWLERS, IDENTITY_CLASS_LABEL, type IdentityClass } from "@/lib/cloudflare/crawlers";
import type { CheckResult, CloudflareZone, HealthStatus } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Cloudflare Monitor" };

const CHECK_LABEL: Record<string, string> = {
  api_connection: "API", waf_rules: "WAF", redirect_rules: "Redirects", bot_settings: "Bots",
  robots_txt: "robots.txt", access_tests: "Access", security_events: "Events", audit_log: "Audit log",
  ai_crawler_policies: "AI policies",
};

export default async function CloudflarePage() {
  const { db, profile } = await requireMember();
  const [{ data: zones }, { data: accounts }, { data: findings }, { data: changes }, { data: audits }, { data: tests }, { data: policies }] = await Promise.all([
    db.from("cloudflare_zones").select("*, clients(name)").order("domain"),
    db.from("cloudflare_accounts").select("id, client_id, connection_status"),
    db.from("cloudflare_findings").select("id, zone_id, severity, title, status, last_seen_at, affected_identities").in("status", ["open", "acknowledged"]),
    db.from("cloudflare_config_changes").select("id, zone_id, configuration_type, severity, potential_impact, detection_source, detected_at, acknowledged").order("detected_at", { ascending: false }).limit(8),
    db.from("cloudflare_audits").select("zone_id, status, checks, executed_at, completed_at").eq("audit_type", "full").order("executed_at", { ascending: false }).limit(50),
    db.from("cloudflare_access_tests").select("zone_id, identity_key, result, tested_at").order("tested_at", { ascending: false }).limit(400),
    db.from("cloudflare_crawler_policies").select("zone_id, identity_key, policy, policy_source"),
  ]);

  const zoneList = (zones ?? []) as (CloudflareZone & { clients: { name: string } | null })[];
  const latestAudit = new Map<string, { status: string; checks: CheckResult[]; completed_at: string | null }>();
  for (const a of audits ?? []) if (!latestAudit.has(a.zone_id)) latestAudit.set(a.zone_id, a as never);
  const openBySeverity = (sev: string) => (findings ?? []).filter((f) => f.severity === sev).length;
  const connectedClients = new Set((accounts ?? []).filter((a) => a.connection_status === "connected").map((a) => a.client_id));
  const pendingRecs = (findings ?? []).filter((f) => f.status === "open").length;

  // Latest access result per zone+identity.
  const latestAccess = new Map<string, string>();
  for (const t of tests ?? []) {
    const k = `${t.zone_id}:${t.identity_key}`;
    if (!latestAccess.has(k)) latestAccess.set(k, t.result);
  }
  const classes: IdentityClass[] = ["search", "user_directed", "browser_agent", "training"];

  return (
    <>
      <PageHeader
        eyebrow="Priority module"
        title="Cloudflare Monitor"
        description="Read-only, advisory monitoring of Cloudflare security and AI-crawler accessibility. EightSignal never changes Cloudflare configuration."
        actions={
          <>
            <Button asChild size="sm" variant="outline"><Link href="/cloudflare/incidents"><Siren /> Incident log</Link></Button>
            {canEdit(profile) && <Button asChild size="sm"><Link href="/cloudflare/setup"><Plus /> Connect / register</Link></Button>}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Connected clients" value={connectedClients.size} icon={KeyRound} />
        <StatCard label="Monitored domains" value={zoneList.filter((z) => z.monitoring_enabled).length} icon={Globe} />
        <StatCard label="Critical findings" value={openBySeverity("critical")} tone={openBySeverity("critical") ? "critical" : "default"} icon={ShieldAlert} />
        <StatCard label="High findings" value={openBySeverity("high")} tone={openBySeverity("high") ? "high" : "default"} icon={AlertTriangle} />
        <StatCard label="Pending recommendations" value={pendingRecs} icon={ListChecks} />
        <StatCard label="Changes (recent)" value={(changes ?? []).filter((c) => !c.acknowledged).length} hint="unacknowledged" />
      </div>

      <section className="mb-6 rounded-lg border border-primary/25 bg-gradient-to-b from-primary/[0.06] to-transparent p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">Cloudflare Security &amp; AI Readiness</h2>
        </div>
        {!zoneList.length ? (
          <EmptyState
            icon={Globe}
            title="No domains registered"
            description="Register Blend360's Cloudflare zone and important URLs to begin auditing."
            action={canEdit(profile) && <Button asChild size="sm"><Link href="/cloudflare/setup">Register a zone</Link></Button>}
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Domain</TH><TH>Client</TH><TH>Status</TH><TH>Checks (last audit)</TH><TH>Open findings</TH><TH>Last audit</TH>
              </TR>
            </THead>
            <TBody>
              {zoneList.map((z) => {
                const audit = latestAudit.get(z.id);
                const zf = (findings ?? []).filter((f) => f.zone_id === z.id);
                return (
                  <TR key={z.id}>
                    <TD><Link href={`/cloudflare/zones/${z.id}`} className="font-medium hover:text-primary">{z.domain}</Link>{!z.monitoring_enabled && <span className="ml-2 text-[11px] text-muted-foreground">(paused)</span>}</TD>
                    <TD className="text-muted-foreground">{z.clients?.name}</TD>
                    <TD><HealthBadge status={z.health_status as HealthStatus} /><div className="mt-1 max-w-56 text-[11px] text-muted-foreground">{z.health_reason}</div></TD>
                    <TD>
                      <div className="flex max-w-80 flex-wrap gap-1">
                        {(audit?.checks ?? []).map((c) => (
                          <span key={c.check} title={c.detail} className={`rounded px-1.5 py-0.5 text-[10px] ${c.status === "completed" ? "bg-ok/15 text-green-300" : c.status === "manual_verification" ? "bg-sev-medium/15 text-yellow-200" : c.status === "failed" ? "bg-sev-critical/15 text-rose-300" : "bg-muted text-muted-foreground"}`}>
                            {CHECK_LABEL[c.check] ?? c.check}
                          </span>
                        ))}
                        {!audit && <span className="text-xs text-muted-foreground">Not audited</span>}
                      </div>
                    </TD>
                    <TD>
                      <div className="flex gap-1">
                        {(["critical", "high", "medium"] as const).map((s) => {
                          const n = zf.filter((f) => f.severity === s).length;
                          return n ? <SeverityBadge key={s} level={s} className="tabular-nums" /> : null;
                        })}
                        <span className="text-xs tabular-nums text-muted-foreground">{zf.length}</span>
                      </div>
                    </TD>
                    <TD className="text-xs text-muted-foreground">{relativeTime(z.last_audited_at)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>AI crawler &amp; agent access</CardTitle>
            <p className="text-xs text-muted-foreground">Latest simulated access result and recorded Cloudflare policy, per identity class. Simulated user-agent tests do not prove how verified crawler traffic is treated.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {zoneList.slice(0, 3).map((z) => (
              <div key={z.id}>
                <div className="mb-1.5 text-xs font-medium">{z.domain}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {classes.map((cls) => (
                    <div key={cls} className="rounded-md border px-3 py-2">
                      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{IDENTITY_CLASS_LABEL[cls]}</div>
                      <ul className="flex flex-col gap-1">
                        {CRAWLERS.filter((c) => c.class === cls).map((c) => {
                          const res = latestAccess.get(`${z.id}:${c.key}`);
                          const pol = (policies ?? []).find((p) => p.zone_id === z.id && p.identity_key === c.key);
                          return (
                            <li key={c.key} className="flex items-center justify-between gap-2 text-xs">
                              <span>{c.name}</span>
                              <span className="flex items-center gap-1">
                                {pol && pol.policy !== "unknown" && <span className="text-[10px] text-muted-foreground">{pol.policy}{pol.policy_source === "manual" ? "*" : ""}</span>}
                                {res ? <StatusBadge status={res} /> : <span className="text-[10px] text-muted-foreground">{c.userAgent ? "untested" : "robots only"}</span>}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!zoneList.length && <p className="text-xs text-muted-foreground">No zones yet.</p>}
            <p className="text-[10px] text-muted-foreground">* manually verified policy</p>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Detected conflicts &amp; findings</CardTitle></CardHeader>
            <CardContent>
              {!(findings ?? []).length ? (
                <p className="text-xs text-muted-foreground">No open findings. That only reflects checks that actually ran — see each zone&apos;s check list.</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {[...(findings ?? [])]
                    .sort((a, b) => ["critical", "high", "medium", "low", "info"].indexOf(a.severity) - ["critical", "high", "medium", "low", "info"].indexOf(b.severity))
                    .slice(0, 8)
                    .map((f) => (
                      <li key={f.id} className="flex items-start gap-2 py-2 text-xs">
                        <SeverityBadge level={f.severity} />
                        <Link href={`/cloudflare/zones/${f.zone_id}#findings`} className="hover:text-primary">{f.title}</Link>
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent configuration changes</CardTitle></CardHeader>
            <CardContent>
              <SectionTitle>Audit history</SectionTitle>
              {!(changes ?? []).length ? (
                <p className="text-xs text-muted-foreground">No changes detected yet. The first audit captures a baseline snapshot.</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {changes!.map((c) => (
                    <li key={c.id} className="flex flex-col gap-1 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge level={c.severity} />
                        <span className="font-medium">{c.configuration_type.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">{c.detection_source.replace("_", " ")} · {relativeTime(c.detected_at)}</span>
                        {c.acknowledged && <StatusBadge status="acknowledged" />}
                      </div>
                      <Link href={`/cloudflare/zones/${c.zone_id}#changes`} className="text-muted-foreground hover:text-foreground">{c.potential_impact}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
