import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader, SectionTitle } from "@/components/shared/page";
import { HealthBadge, SeverityBadge, StatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BASELINE_BROWSER, CRAWLERS, IDENTITY_CLASS_LABEL } from "@/lib/cloudflare/crawlers";
import { analyzeRobots } from "@/lib/cloudflare/robots";
import { diffConfigs } from "@/lib/cloudflare/snapshot";
import { CHECK_NAMES } from "@/lib/cloudflare/health";
import type { CheckResult, CloudflareFinding, HealthStatus } from "@/lib/types";
import { formatDate, relativeTime } from "@/lib/utils";
import { acknowledgeChange, removeMonitoredUrl, setZoneAccount, toggleZoneMonitoring, updateFindingStatus } from "../../actions";
import { AccessTestForm, AddUrlForm, FindingTaskForm, PolicyForm, RunAuditForm } from "./client-forms";

const SEV_ORDER = ["critical", "high", "medium", "low", "info"];

interface RuleSnapshot {
  rules: { id: string; action: string; expression: string; description: string | null; enabled: boolean; last_updated: string | null; action_parameters?: Record<string, unknown> | null }[];
}

export default async function ZonePage({ params, searchParams }: PageProps<"/cloudflare/zones/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, profile } = await requireMember();
  const editor = canEdit(profile);

  const { data: zone } = await db.from("cloudflare_zones").select("*, clients(id, name), cloudflare_accounts(id, account_name, connection_status, connection_error)").eq("id", id).maybeSingle();
  if (!zone) notFound();

  const [
    { data: audits }, { data: findings }, { data: urls }, { data: tests }, { data: changes },
    { data: snapshots }, { data: policies }, { data: accounts },
  ] = await Promise.all([
    db.from("cloudflare_audits").select("id, status, trigger, checks, executed_at, completed_at, error_message").eq("zone_id", id).eq("audit_type", "full").order("executed_at", { ascending: false }).limit(10),
    db.from("cloudflare_findings").select("*").eq("zone_id", id).order("last_seen_at", { ascending: false }).limit(200),
    db.from("monitored_urls").select("*").eq("zone_id", id).eq("is_active", true).order("is_critical", { ascending: false }),
    db.from("cloudflare_access_tests").select("*").eq("zone_id", id).order("tested_at", { ascending: false }).limit(120),
    db.from("cloudflare_config_changes").select("*").eq("zone_id", id).order("detected_at", { ascending: false }).limit(25),
    db.from("cloudflare_config_snapshots").select("id, configuration_type, configuration_data, configuration_hash, captured_at").eq("zone_id", id).order("captured_at", { ascending: false }).limit(60),
    db.from("cloudflare_crawler_policies").select("*").eq("zone_id", id),
    db.from("cloudflare_accounts").select("id, account_name").eq("client_id", zone.client_id),
  ]);

  const client = zone.clients as { id: string; name: string } | null;
  const account = zone.cloudflare_accounts as { id: string; account_name: string; connection_status: string; connection_error: string | null } | null;
  const lastAudit = audits?.[0];
  const allFindings = (findings ?? []) as CloudflareFinding[];
  const openFindings = allFindings.filter((f) => f.status === "open" || f.status === "acknowledged").sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  const closedFindings = allFindings.filter((f) => !(f.status === "open" || f.status === "acknowledged")).slice(0, 15);
  const latestSnap = (type: string) => snapshots?.find((s) => s.configuration_type === type);
  const waf = latestSnap("waf_custom_rules")?.configuration_data as RuleSnapshot | undefined;
  const redirects = latestSnap("redirect_rules")?.configuration_data as RuleSnapshot | undefined;
  const robotsSnap = latestSnap("robots_txt")?.configuration_data as { content: string; final_url: string } | undefined;
  const robots = robotsSnap ? analyzeRobots(robotsSnap.content) : null;

  const latestTest = new Map<string, NonNullable<typeof tests>[number]>();
  for (const t of tests ?? []) if (!latestTest.has(t.identity_key)) latestTest.set(t.identity_key, t);

  // Snapshot comparison (?compare=<snapshotId>)
  const compareId = typeof sp.compare === "string" ? sp.compare : null;
  let comparison: { type: string; at: string; prevAt: string | null; diff: ReturnType<typeof diffConfigs> } | null = null;
  if (compareId && snapshots) {
    const cur = snapshots.find((s) => s.id === compareId);
    if (cur) {
      const prev = snapshots.find((s) => s.configuration_type === cur.configuration_type && s.captured_at < cur.captured_at);
      comparison = { type: cur.configuration_type, at: cur.captured_at, prevAt: prev?.captured_at ?? null, diff: prev ? diffConfigs(prev.configuration_data, cur.configuration_data) : [] };
    }
  }

  return (
    <>
      <Link href="/cloudflare" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" /> Cloudflare Monitor</Link>
      <PageHeader
        eyebrow={client?.name ?? "Zone"}
        title={zone.domain}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <HealthBadge status={zone.health_status as HealthStatus} />
            <span>{zone.health_reason}</span>
            <span className="text-muted-foreground">· Last audit {relativeTime(zone.last_audited_at)}{zone.plan_name ? ` · ${zone.plan_name}` : ""}</span>
          </span>
        }
        actions={editor && <RunAuditForm zoneId={id} />}
      />

      <div className="mb-4 flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-blue-100">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Advisory mode: EightSignal only reads Cloudflare configuration and makes ordinary HTTP requests. It never modifies WAF rules, redirects, DNS or bot settings. Apply changes manually after human approval.
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Last audit</CardTitle></CardHeader>
          <CardContent>
            {!lastAudit ? (
              <p className="text-sm text-muted-foreground">No audit has been run. Status cannot be &quot;Healthy&quot; until checks complete.</p>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={lastAudit.status} /> {lastAudit.trigger} · {formatDate(lastAudit.executed_at, true)}
                  {lastAudit.error_message && <span className="text-rose-300">{lastAudit.error_message}</span>}
                </div>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {(lastAudit.checks as CheckResult[]).map((c) => (
                    <li key={c.check} className="flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                      <StatusBadge status={c.status === "manual_verification" ? "manual check" : c.status} />
                      <div>
                        <div className="font-medium">{CHECK_NAMES[c.check] ?? c.check}</div>
                        {c.detail && <div className="text-muted-foreground">{c.detail}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Connection</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Account</span>
              <span>{account ? account.account_name : "None"} {account && <StatusBadge status={account.connection_status} />}</span>
            </div>
            {account?.connection_error && <p className="text-rose-300">{account.connection_error}</p>}
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Zone ID</span><code className="text-[11px]">{zone.zone_identifier ?? "auto-detect on audit"}</code></div>
            {editor && (
              <>
                <form action={setZoneAccount} className="flex gap-2">
                  <input type="hidden" name="zone_id" value={id} />
                  <Select name="cloudflare_account_id" defaultValue={zone.cloudflare_account_id ?? ""} className="h-8 text-xs" aria-label="Cloudflare account">
                    <option value="">No API account (HTTP checks only)</option>
                    {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
                  </Select>
                  <Button size="sm" variant="secondary" type="submit">Link</Button>
                </form>
                <form action={toggleZoneMonitoring}>
                  <input type="hidden" name="zone_id" value={id} />
                  <input type="hidden" name="enabled" value={zone.monitoring_enabled ? "0" : "1"} />
                  <Button size="sm" variant="ghost" type="submit">{zone.monitoring_enabled ? "Pause scheduled monitoring" : "Resume scheduled monitoring"}</Button>
                </form>
                <Link href="/cloudflare/setup" className="text-primary hover:underline">Manage accounts &amp; tokens →</Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Findings */}
      <Card className="mt-4" id="findings">
        <CardHeader><CardTitle>Findings ({openFindings.length} open)</CardTitle></CardHeader>
        <CardContent>
          {!openFindings.length ? (
            <p className="text-xs text-muted-foreground">No open findings from completed checks.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {openFindings.map((f) => (
                <li key={f.id} className="rounded-md border px-3 py-2.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge level={f.severity} />
                        <span className="text-sm font-medium">{f.title}</span>
                        {f.status === "acknowledged" && <StatusBadge status="acknowledged" />}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>
                      {f.recommendation && <p className="mt-1 text-xs"><span className="text-primary">Recommendation:</span> {f.recommendation}</p>}
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[11px] text-muted-foreground">Evidence · first seen {formatDate(f.first_seen_at)} · last seen {relativeTime(f.last_seen_at)}</summary>
                        <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted/40 p-2 font-mono text-[10px]">{JSON.stringify(f.evidence, null, 2)}</pre>
                      </details>
                    </div>
                    {editor && (
                      <div className="flex shrink-0 flex-col gap-1.5 sm:w-44">
                        <form action={updateFindingStatus} className="flex gap-1">
                          <input type="hidden" name="id" value={f.id} />
                          <Select name="status" defaultValue={f.status} className="h-8 text-xs" aria-label="Finding status">
                            {["open", "acknowledged", "resolved", "false_positive", "accepted_risk"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                          </Select>
                          <Button size="sm" variant="secondary" type="submit">Set</Button>
                        </form>
                        <FindingTaskForm findingId={f.id} />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {closedFindings.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">Recently closed ({closedFindings.length})</summary>
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {closedFindings.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 text-muted-foreground"><StatusBadge status={f.status} /> {f.title} · {formatDate(f.resolved_at)}</li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      {/* AI access matrix */}
      <Card className="mt-4" id="ai-access">
        <CardHeader>
          <CardTitle>AI crawler &amp; agent access matrix</CardTitle>
          <p className="text-xs text-muted-foreground">
            Search crawlers, user-directed fetchers, browser agents and training crawlers are evaluated separately — allowing one never implies the others.
            &quot;Observed access&quot; is a <strong>simulated user-agent test</strong> from EightSignal&apos;s server, not verified crawler traffic.
          </p>
        </CardHeader>
        <CardContent>
          {editor && <div className="mb-3 max-w-xl"><AccessTestForm zoneId={id} identities={CRAWLERS.filter((c) => c.userAgent).map((c) => ({ key: c.key, name: c.name }))} /></div>}
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Identity</TH><TH>Purpose</TH><TH>Cloudflare policy</TH><TH>robots.txt</TH><TH>Observed access</TH><TH>Last activity</TH><TH>Conflicts / action</TH>
              </TR>
            </THead>
            <TBody>
              {(["search", "user_directed", "browser_agent", "training"] as const).map((cls) => (
                <Fragment key={cls}>
                  <TR className="bg-muted/20 hover:bg-muted/20"><TD colSpan={7} className="py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{IDENTITY_CLASS_LABEL[cls]}</TD></TR>
                  {CRAWLERS.filter((c) => c.class === cls).map((c) => {
                    const pol = policies?.find((p) => p.identity_key === c.key);
                    const test = latestTest.get(c.key);
                    const robotsRes = robots?.identities.find((r) => r.identity === c.key);
                    const related = openFindings.filter((f) => f.affected_identities.includes(c.key));
                    const conflict = robotsRes?.homepageAllowed && pol && ["block", "challenge"].includes(pol.policy)
                      ? "robots.txt allows, Cloudflare blocks/challenges"
                      : robotsRes && !robotsRes.homepageAllowed && test?.result === "accessible"
                        ? "robots.txt disallows but requests succeed (robots is advisory)"
                        : null;
                    return (
                      <TR key={c.key}>
                        <TD>
                          <div className="font-medium">{c.name}</div>
                          <div className="text-[11px] text-muted-foreground">{c.provider}{c.uaConfidence === "token" ? " · UA token only" : c.uaConfidence === "robots_only" ? " · robots token only" : ""}</div>
                        </TD>
                        <TD className="max-w-56 text-xs text-muted-foreground">{c.purpose}</TD>
                        <TD className="text-xs">
                          {pol ? (
                            <span className="flex flex-col">
                              <span className="capitalize">{pol.policy.replace("_", " ")}</span>
                              <span className="text-[10px] text-muted-foreground">{pol.policy_source === "manual" ? "manually verified" : "derived from API"}</span>
                            </span>
                          ) : <span className="text-muted-foreground">Unverified</span>}
                          {editor && <PolicyForm zoneId={id} identityKey={c.key} current={pol?.policy} />}
                        </TD>
                        <TD className="text-xs">
                          {robotsRes ? (
                            <span className={robotsRes.homepageAllowed ? "text-green-300" : "text-orange-300"}>
                              {robotsRes.homepageAllowed ? "Allowed" : "Disallowed"} <span className="text-[10px] text-muted-foreground">({robotsRes.matched})</span>
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TD>
                        <TD className="text-xs">
                          {test ? (
                            <span className="flex flex-col gap-0.5"><StatusBadge status={test.result} /><span className="text-[10px] text-muted-foreground">HTTP {test.http_status ?? "—"} · {relativeTime(test.tested_at)}</span></span>
                          ) : <span className="text-muted-foreground">{c.userAgent ? "Not tested" : "Cannot simulate"}</span>}
                        </TD>
                        <TD className="text-xs text-muted-foreground">{pol?.last_observed_activity_at ? relativeTime(pol.last_observed_activity_at) : "—"}</TD>
                        <TD className="max-w-64 text-xs">
                          {conflict && <div className="text-orange-300">{conflict}</div>}
                          {related.slice(0, 2).map((f) => <div key={f.id} className="text-muted-foreground"><SeverityBadge level={f.severity} /> {f.recommendation}</div>)}
                          {!conflict && !related.length && <span className="text-muted-foreground">None detected</span>}
                        </TD>
                      </TR>
                    );
                  })}
                </Fragment>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>robots.txt analysis</CardTitle>
            <p className="text-xs text-muted-foreground">robots.txt is a request to well-behaved crawlers; it is not enforcement. A crawler allowed here can still be blocked by Cloudflare, and vice versa.</p>
          </CardHeader>
          <CardContent>
            {!robots ? (
              <p className="text-xs text-muted-foreground">Not captured yet — run an audit.</p>
            ) : (
              <div className="flex flex-col gap-3 text-xs">
                <div className="flex flex-wrap gap-2">
                  {robots.cloudflareManaged && <Badge variant="default">Cloudflare-managed section</Badge>}
                  {robots.wildcardDisallowAll && <Badge variant="critical">User-agent: * Disallow: /</Badge>}
                  {robots.contentSignals.map((s) => <Badge key={s} variant="secondary">Content-Signal: {s}</Badge>)}
                </div>
                <div>
                  <SectionTitle>Sitemaps</SectionTitle>
                  {robots.sitemaps.length ? robots.sitemaps.map((s) => <div key={s} className="break-all font-mono text-[11px]">{s}</div>) : <span className="text-muted-foreground">None referenced</span>}
                </div>
                <Table>
                  <THead><TR className="hover:bg-transparent"><TH>Token</TH><TH>Group</TH><TH>Homepage</TH><TH>Directives</TH></TR></THead>
                  <TBody>
                    {robots.identities.map((r) => (
                      <TR key={r.token}>
                        <TD className="font-mono text-[11px]">{r.token}</TD>
                        <TD className="text-muted-foreground">{r.matched}</TD>
                        <TD>{r.homepageAllowed ? <span className="text-green-300">allowed</span> : <span className="text-orange-300">disallowed</span>}</TD>
                        <TD className="font-mono text-[10px] text-muted-foreground">{r.directives.slice(0, 4).map((d) => `${d.type}: ${d.path || "(empty)"}`).join("  ")}{r.directives.length > 4 ? " …" : ""}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Raw robots.txt ({robotsSnap?.final_url})</summary>
                  <pre className="mt-1 max-h-72 overflow-auto rounded bg-muted/40 p-2 font-mono text-[10px]">{robotsSnap?.content}</pre>
                </details>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <RuleTable title="WAF custom rules" snapshot={waf} empty="No WAF snapshot — requires a token with Zone WAF read access." />
          <RuleTable title="Redirect rules" snapshot={redirects} empty="No redirect snapshot — requires a token with read access to rulesets." redirect />
        </div>
      </div>

      {/* Access tests */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Website accessibility tests</CardTitle>
          <p className="text-xs text-muted-foreground">Simulated requests with configured user-agents. Changing a user-agent does not prove a request came from an authentic crawler; compare with Cloudflare Security Events for verified traffic.</p>
        </CardHeader>
        <CardContent>
          {!(tests ?? []).length ? (
            <p className="text-xs text-muted-foreground">No tests yet.</p>
          ) : (
            <Table>
              <THead><TR className="hover:bg-transparent"><TH>URL</TH><TH>Identity</TH><TH>Type</TH><TH>Result</TH><TH>HTTP</TH><TH>Time</TH><TH>Final URL / chain</TH><TH>Tested</TH></TR></THead>
              <TBody>
                {tests!.slice(0, 60).map((t) => {
                  const chain = (t.redirect_chain ?? []) as { url: string; status: number }[];
                  return (
                    <TR key={t.id}>
                      <TD className="max-w-48 truncate text-xs" title={t.target_url}>{t.target_url.replace(/^https?:\/\//, "")}</TD>
                      <TD className="text-xs">{t.identity_key === BASELINE_BROWSER.key ? "Browser" : CRAWLERS.find((c) => c.key === t.identity_key)?.name ?? t.identity_key}</TD>
                      <TD className="text-[11px] text-muted-foreground">{t.test_type === "baseline_browser" ? "baseline" : "simulated UA"}</TD>
                      <TD><StatusBadge status={t.result} />{t.challenge_detected && <span className="ml-1 text-[10px] text-orange-300">challenge</span>}</TD>
                      <TD className="tabular-nums text-xs">{t.http_status ?? "—"}</TD>
                      <TD className="tabular-nums text-xs text-muted-foreground">{t.response_time_ms ? `${t.response_time_ms}ms` : "—"}</TD>
                      <TD className="max-w-56 text-[11px] text-muted-foreground">
                        {t.error_message ? <span className="text-rose-300">{t.error_message}</span> : (
                          <details>
                            <summary className="cursor-pointer truncate">{chain.length ? `${chain.length} redirect(s) → ` : ""}{t.final_url?.replace(/^https?:\/\//, "")}</summary>
                            <div className="mt-1 flex flex-col gap-0.5 font-mono text-[10px]">
                              {chain.map((h, i) => <span key={i}>{h.status} {h.url}</span>)}
                              <span>Headers: {Object.entries((t.response_headers ?? {}) as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(" | ")}</span>
                            </div>
                          </details>
                        )}
                      </TD>
                      <TD className="text-[11px] text-muted-foreground">{relativeTime(t.tested_at)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Changes & snapshots */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card id="changes">
          <CardHeader><CardTitle>Configuration change history</CardTitle></CardHeader>
          <CardContent>
            {!(changes ?? []).length ? (
              <p className="text-xs text-muted-foreground">No changes recorded. Detected differences are not assumed to be malicious.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {changes!.map((c) => (
                  <li key={c.id} className="py-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge level={c.severity} />
                      <span className="font-medium">{c.configuration_type.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground">via {c.detection_source.replace("_", " ")} · {formatDate(c.detected_at, true)}</span>
                      {c.acknowledged ? <StatusBadge status="acknowledged" /> : editor && (
                        <form action={acknowledgeChange}><input type="hidden" name="id" value={c.id} /><Button size="sm" variant="ghost" type="submit" className="h-6 text-[11px]">Acknowledge</Button></form>
                      )}
                    </div>
                    <p className="mt-1 text-muted-foreground">{c.potential_impact}</p>
                    {c.recommended_action && <p className="mt-0.5">→ {c.recommended_action}</p>}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">Diff ({(c.diff as unknown[]).length})</summary>
                      <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted/40 p-2 font-mono text-[10px]">{JSON.stringify(c.diff, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card id="snapshots">
          <CardHeader><CardTitle>Configuration snapshots</CardTitle></CardHeader>
          <CardContent>
            {comparison && (
              <div className="mb-3 rounded-md border bg-muted/30 p-3 text-xs">
                <div className="mb-1 font-medium">{comparison.type.replace(/_/g, " ")}: {comparison.prevAt ? `${formatDate(comparison.prevAt, true)} → ${formatDate(comparison.at, true)}` : "baseline (no earlier snapshot)"}</div>
                {comparison.diff.length === 0 ? <p className="text-muted-foreground">No behavioural differences.</p> : (
                  <ul className="flex flex-col gap-1">
                    {comparison.diff.map((d, i) => (
                      <li key={i}>
                        <Badge variant={d.kind === "added" ? "ok" : d.kind === "removed" ? "critical" : "medium"}>{d.kind}</Badge> {d.label}
                        {d.changes && <span className="text-muted-foreground"> — {d.changes.map((ch) => ch.field).join(", ")}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!(snapshots ?? []).length ? <p className="text-xs text-muted-foreground">No snapshots yet.</p> : (
              <ul className="flex flex-col divide-y text-xs">
                {snapshots!.slice(0, 20).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span><span className="font-medium">{s.configuration_type.replace(/_/g, " ")}</span> <span className="text-muted-foreground">· {formatDate(s.captured_at, true)} · {s.configuration_hash.slice(0, 10)}</span></span>
                    <Link href={`/cloudflare/zones/${id}?compare=${s.id}#snapshots`} className="text-primary hover:underline">Compare with previous</Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monitored URLs */}
      <Card className="mt-4">
        <CardHeader><CardTitle>Monitored URLs</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y text-xs">
            {(urls ?? []).map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">
                  {u.is_critical && <Badge variant="high" className="mr-1.5">critical</Badge>}
                  <Badge variant="secondary" className="mr-1.5">{u.page_type}</Badge>
                  {u.label && <span className="mr-1.5 font-medium">{u.label}</span>}
                  <span className="text-muted-foreground">{u.url}</span>
                </span>
                {editor && (
                  <form action={removeMonitoredUrl}><input type="hidden" name="id" value={u.id} /><Button size="sm" variant="ghost" type="submit" className="h-6 text-[11px]">Remove</Button></form>
                )}
              </li>
            ))}
          </ul>
          {editor && <AddUrlForm zoneId={id} domain={zone.domain} />}
          <p className="text-[11px] text-muted-foreground">Critical URLs are tested with every identity during each full audit; all URLs are tested on demand.</p>
        </CardContent>
      </Card>
    </>
  );
}

function RuleTable({ title, snapshot, empty, redirect }: { title: string; snapshot?: RuleSnapshot; empty: string; redirect?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}{snapshot ? ` (${snapshot.rules.length})` : ""}</CardTitle></CardHeader>
      <CardContent>
        {!snapshot ? <p className="text-xs text-muted-foreground">{empty}</p> : !snapshot.rules.length ? <p className="text-xs text-muted-foreground">No rules configured.</p> : (
          <ol className="flex flex-col gap-2">
            {snapshot.rules.map((r, i) => {
              const target = (r.action_parameters as { from_value?: { target_url?: { value?: string; expression?: string }; status_code?: number } } | null)?.from_value;
              return (
                <li key={r.id} className="rounded-md border px-2.5 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums text-muted-foreground">#{i + 1}</span>
                    <span className="font-medium">{r.description || r.id.slice(0, 8)}</span>
                    <Badge variant={r.action === "block" ? "critical" : /challenge/.test(r.action) ? "high" : r.action === "skip" ? "ok" : "secondary"}>{r.action}</Badge>
                    {!r.enabled && <Badge variant="outline">disabled</Badge>}
                    {r.last_updated && <span className="text-[10px] text-muted-foreground">updated {formatDate(r.last_updated)}</span>}
                  </div>
                  <code className="mt-1 block break-all font-mono text-[10px] text-muted-foreground">{r.expression}</code>
                  {redirect && target && (
                    <div className="mt-1 font-mono text-[10px]">→ {target.status_code ?? ""} {target.target_url?.value ?? target.target_url?.expression}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
