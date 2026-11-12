import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeFetch, SafeFetchError } from "@/lib/security/safe-fetch";
import type { CheckResult, Severity } from "@/lib/types";
import { logActivity } from "@/lib/activity";
import { CloudflareReadOnlyClient, type CfResult } from "./api";
import { auditWafRules } from "./waf-audit";
import { auditRedirects, normalizePageRuleRedirects, normalizeSingleRedirects } from "./redirect-audit";
import { analyzeRobots } from "./robots";
import { classifyAccess, sanitizeHeaders } from "./access";
import { BASELINE_BROWSER, CRAWLERS, identitiesMentioned } from "./crawlers";
import { configHash, diffConfigs, type ConfigDiffEntry } from "./snapshot";
import { computeHealth } from "./health";
import { SEVERITY_RANK, type DraftFinding } from "./findings";
import { resolveToken } from "./token";

type ConfigType = "waf_custom_rules" | "redirect_rules" | "bot_management" | "robots_txt" | "page_rules";

interface RunContext {
  db: SupabaseClient; // service-role client; caller must already be authorized
  zone: ZoneRow;
  auditId: string;
  checks: CheckResult[];
  findings: DraftFinding[];
  coveredPrefixes: string[]; // finding-key prefixes whose checks completed (eligible for auto-resolve)
  changes: number;
}

interface ZoneRow {
  id: string;
  domain: string;
  zone_identifier: string | null;
  cloudflare_account_id: string | null;
  client_id: string;
}

export interface AuditSummary {
  auditId: string;
  status: "completed" | "partial" | "failed";
  checks: CheckResult[];
  findings: number;
  changes: number;
  health: string;
}

function unavailable(res: Extract<CfResult<unknown>, { ok: false }>): string {
  if (res.reason === "forbidden") return `Token lacks permission (${res.message}). Add the read scope or verify manually in the dashboard.`;
  if (res.reason === "unauthorized") return "Token rejected by Cloudflare.";
  if (res.reason === "rate_limited") return "Cloudflare API rate limit reached; retry later.";
  return res.message;
}

async function snapshot(ctx: RunContext, type: ConfigType, data: unknown) {
  const hash = configHash(data);
  const { data: prev } = await ctx.db
    .from("cloudflare_config_snapshots")
    .select("id, configuration_data, configuration_hash")
    .eq("zone_id", ctx.zone.id)
    .eq("configuration_type", type)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prev && prev.configuration_hash === hash) return; // unchanged: no new snapshot
  const { data: inserted, error } = await ctx.db
    .from("cloudflare_config_snapshots")
    .insert({ zone_id: ctx.zone.id, audit_id: ctx.auditId, configuration_type: type, configuration_data: data, configuration_hash: hash })
    .select("id")
    .single();
  if (error) throw new Error(`Snapshot insert failed: ${error.message}`);
  if (!prev) return; // first snapshot is the baseline, not a change
  const diff = diffConfigs(prev.configuration_data, data);
  if (!diff.length) return;
  const { severity, impact, action } = assessChange(type, diff);
  await ctx.db.from("cloudflare_config_changes").insert({
    zone_id: ctx.zone.id,
    configuration_type: type,
    previous_snapshot_id: prev.id,
    current_snapshot_id: inserted.id,
    previous_configuration: prev.configuration_data,
    current_configuration: data,
    diff,
    detection_source: "snapshot_diff",
    potential_impact: impact,
    recommended_action: action,
    severity,
  });
  ctx.changes++;
  if (SEVERITY_RANK[severity] >= SEVERITY_RANK.medium) {
    ctx.findings.push({
      key: `change:${type}:${inserted.id}`,
      type: "config_change",
      severity,
      title: `${type.replace(/_/g, " ")} changed (${diff.length} difference${diff.length === 1 ? "" : "s"})`,
      description: `${impact} A configuration difference is not necessarily malicious — confirm it was an approved change.`,
      recommendation: action,
      evidence: { diff: diff.slice(0, 20), snapshot_id: inserted.id },
      identities: [],
    });
  }
}

export function assessChange(type: ConfigType, diff: ConfigDiffEntry[]): { severity: Severity; impact: string; action: string } {
  const text = JSON.stringify(diff).toLowerCase();
  const touchesBots = identitiesMentioned(text).length > 0 || /user_agent|cf\.client\.bot|verified_bot/.test(text);
  const enabledNew = diff.some((d) => d.kind === "added" && (d.after as { enabled?: boolean })?.enabled !== false);
  switch (type) {
    case "waf_custom_rules":
      return {
        severity: touchesBots ? "high" : enabledNew ? "medium" : "low",
        impact: `WAF custom rules changed${touchesBots ? " in a way that references bots or user-agents" : ""}. Changes can alter which visitors, crawlers and agents are blocked or challenged.`,
        action: "Confirm the change was approved, then re-run access tests for important URLs.",
      };
    case "redirect_rules":
    case "page_rules":
      return {
        severity: touchesBots ? "critical" : "high",
        impact: `Redirect configuration changed${touchesBots ? " with bot/user-agent conditions" : ""}. Unexpected redirects have previously been associated with unauthorized changes on monitored sites.`,
        action: "Verify the author and purpose of the redirect change immediately; record an incident if it was not approved.",
      };
    case "bot_management":
      return {
        severity: "high",
        impact: "Bot management settings changed. This can change how AI crawlers and verified bots are treated across the whole zone.",
        action: "Review the new bot settings against the client's AI access policy and re-run access tests.",
      };
    case "robots_txt":
      return {
        severity: "medium",
        impact: "robots.txt content changed, which changes crawl directives for search and AI crawlers.",
        action: "Review the robots.txt diff and confirm it matches the intended crawler policy.",
      };
  }
}

async function runConfigChecks(ctx: RunContext, client: CloudflareReadOnlyClient, cfZoneId: string, accountIdentifier: string | null) {
  // WAF custom rules
  const waf = await client.getPhaseEntrypoint(cfZoneId, "http_request_firewall_custom");
  if (waf.ok || waf.reason === "not_found") {
    const rules = waf.ok ? waf.data.rules ?? [] : [];
    await snapshot(ctx, "waf_custom_rules", { rules: rules.map(stripRule) });
    ctx.findings.push(...auditWafRules({ rules, domain: ctx.zone.domain }));
    ctx.checks.push({ check: "waf_rules", status: "completed", detail: `${rules.length} custom rule(s) reviewed` });
    ctx.coveredPrefixes.push("waf:");
    await derivePoliciesFromWaf(ctx, rules);
  } else {
    ctx.checks.push({ check: "waf_rules", status: "unavailable", detail: unavailable(waf) });
  }

  // Redirect rules (Single Redirects) + legacy Page Rules forwarding
  const redirects = await client.getPhaseEntrypoint(cfZoneId, "http_request_dynamic_redirect");
  const pageRules = await client.getPageRules(cfZoneId);
  if (redirects.ok || redirects.reason === "not_found") {
    const rules = redirects.ok ? redirects.data.rules ?? [] : [];
    await snapshot(ctx, "redirect_rules", { rules: rules.map(stripRule) });
    const normalized = normalizeSingleRedirects(rules);
    if (pageRules.ok) {
      await snapshot(ctx, "page_rules", { rules: pageRules.data });
      normalized.push(...normalizePageRuleRedirects(pageRules.data));
    }
    ctx.findings.push(...auditRedirects(normalized, ctx.zone.domain));
    ctx.checks.push({
      check: "redirect_rules",
      status: "completed",
      detail: `${normalized.length} redirect(s) reviewed${pageRules.ok ? "" : "; Page Rules not readable with this token"}`,
    });
    ctx.coveredPrefixes.push("redirect:");
  } else {
    ctx.checks.push({ check: "redirect_rules", status: "unavailable", detail: unavailable(redirects) });
  }

  // Bot management (includes AI-bot related settings on plans that expose them)
  const bots = await client.getBotManagement(cfZoneId);
  if (bots.ok) {
    await snapshot(ctx, "bot_management", bots.data);
    const aiSetting = (bots.data as { ai_bots_protection?: string }).ai_bots_protection;
    ctx.checks.push({
      check: "bot_settings",
      status: "completed",
      detail: aiSetting ? `AI bots protection: ${aiSetting}` : "Bot settings captured (no AI bots field returned)",
    });
    if (aiSetting === "block") {
      ctx.findings.push({
        key: "bot:ai-bots-block",
        type: "bot_ai_block_enabled",
        severity: "medium",
        title: "Cloudflare \"Block AI bots\" is enabled",
        description: "Zone-wide AI bot blocking is on. Depending on Cloudflare's current categorisation this may affect AI search crawlers and user-directed agents, not only training crawlers.",
        recommendation: "Confirm with the client which AI identities should be allowed, then review per-crawler settings in AI Crawl Control (manual verification).",
        evidence: { ai_bots_protection: aiSetting },
        identities: CRAWLERS.filter((c) => c.class === "training").map((c) => c.key),
      });
    }
    ctx.coveredPrefixes.push("bot:");
  } else {
    ctx.checks.push({ check: "bot_settings", status: "unavailable", detail: unavailable(bots) });
  }
  ctx.checks.push({
    check: "ai_crawler_policies",
    status: "manual_verification",
    detail: "Per-crawler AI Crawl Control policies are not read via API by EightSignal. Record them in the AI access matrix after checking the dashboard.",
  });

  // Security events (GraphQL analytics)
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const events = await client.getSecurityEvents(cfZoneId, since);
  if (events.ok) {
    await processSecurityEvents(ctx, events.data);
    ctx.checks.push({ check: "security_events", status: "completed", detail: `${events.data.length} event(s) in the last 24h` });
    ctx.coveredPrefixes.push("events:");
  } else {
    ctx.checks.push({ check: "security_events", status: "unavailable", detail: unavailable(events) });
  }

  // Account audit log (configuration change information)
  if (accountIdentifier) {
    const logs = await client.getAuditLogs(accountIdentifier, since);
    if (logs.ok) {
      const relevant = logs.data.filter((l) => /zone|ruleset|firewall|page_rule|redirect|dns|bot/i.test(`${l.resource?.type} ${l.action?.type}`));
      for (const l of relevant.slice(0, 50)) {
        const { data: exists } = await ctx.db
          .from("cloudflare_config_changes")
          .select("id")
          .eq("zone_id", ctx.zone.id)
          .eq("detection_source", "audit_log")
          .contains("diff", [{ audit_log_id: l.id }])
          .maybeSingle();
        if (exists) continue;
        await ctx.db.from("cloudflare_config_changes").insert({
          zone_id: ctx.zone.id,
          configuration_type: l.resource?.type ?? "unknown",
          diff: [{ audit_log_id: l.id, action: l.action?.type, actor_type: l.actor?.type, resource: l.resource, when: l.when }],
          current_configuration: { metadata: l.metadata ?? {} },
          detection_source: "audit_log",
          potential_impact: `Cloudflare audit log: ${l.action?.type ?? "change"} on ${l.resource?.type ?? "resource"} by ${l.actor?.email ?? l.actor?.type ?? "unknown actor"}.`,
          recommended_action: "Confirm this administrative change was expected.",
          severity: "info",
          detected_at: l.when ?? new Date().toISOString(),
        });
        ctx.changes++;
      }
      ctx.checks.push({ check: "audit_log", status: "completed", detail: `${relevant.length} relevant audit log entr${relevant.length === 1 ? "y" : "ies"} in 24h` });
    } else {
      ctx.checks.push({ check: "audit_log", status: "unavailable", detail: unavailable(logs) });
    }
  } else {
    ctx.checks.push({ check: "audit_log", status: "skipped", detail: "No Cloudflare account ID recorded" });
  }
}

function stripRule(r: { id: string; action: string; expression: string; description?: string; enabled: boolean; last_updated?: string; action_parameters?: Record<string, unknown> }) {
  return {
    id: r.id, action: r.action, expression: r.expression, description: r.description ?? null,
    enabled: r.enabled, last_updated: r.last_updated ?? null, action_parameters: r.action_parameters ?? null,
  };
}

async function derivePoliciesFromWaf(ctx: RunContext, rules: { action: string; expression: string; enabled: boolean }[]) {
  const derived = new Map<string, "block" | "challenge">();
  for (const r of rules) {
    if (!r.enabled || !/http\.user_agent/i.test(r.expression) || /not\s+http\.user_agent/i.test(r.expression)) continue;
    const policy = r.action === "block" ? "block" : /challenge/.test(r.action) ? "challenge" : null;
    if (!policy) continue;
    for (const id of identitiesMentioned(r.expression)) {
      if (derived.get(id.key) !== "block") derived.set(id.key, policy);
    }
  }
  // Only write API-derived rows; never overwrite a manual verification with less information.
  const { data: existing } = await ctx.db
    .from("cloudflare_crawler_policies")
    .select("identity_key, policy_source")
    .eq("zone_id", ctx.zone.id);
  const manual = new Set((existing ?? []).filter((e) => e.policy_source === "manual").map((e) => e.identity_key));
  for (const [key, policy] of derived) {
    if (manual.has(key)) continue;
    await ctx.db.from("cloudflare_crawler_policies").upsert(
      { zone_id: ctx.zone.id, identity_key: key, policy, policy_source: "api", notes: "Derived from enabled WAF custom rule matching this user-agent.", updated_at: new Date().toISOString() },
      { onConflict: "zone_id,identity_key" },
    );
  }
}

async function processSecurityEvents(ctx: RunContext, events: { action: string; userAgent: string; clientRequestPath: string; datetime: string; ruleId: string; source: string }[]) {
  const latest = new Map<string, string>();
  const blocked = new Map<string, { count: number; paths: Set<string>; rules: Set<string> }>();
  for (const e of events) {
    for (const id of identitiesMentioned(e.userAgent ?? "")) {
      if (!latest.has(id.key) || latest.get(id.key)! < e.datetime) latest.set(id.key, e.datetime);
      if (/block|challenge/.test(e.action)) {
        const b = blocked.get(id.key) ?? { count: 0, paths: new Set(), rules: new Set() };
        b.count++;
        b.paths.add(e.clientRequestPath);
        b.rules.add(`${e.source}:${e.ruleId}`);
        blocked.set(id.key, b);
      }
    }
  }
  for (const [key, at] of latest) {
    await ctx.db
      .from("cloudflare_crawler_policies")
      .upsert(
        { zone_id: ctx.zone.id, identity_key: key, policy: "unknown", policy_source: "api", last_observed_activity_at: at, updated_at: new Date().toISOString() },
        { onConflict: "zone_id,identity_key", ignoreDuplicates: true },
      );
    await ctx.db
      .from("cloudflare_crawler_policies")
      .update({ last_observed_activity_at: at })
      .eq("zone_id", ctx.zone.id)
      .eq("identity_key", key);
  }
  for (const [key, b] of blocked) {
    const c = CRAWLERS.find((x) => x.key === key)!;
    ctx.findings.push({
      key: `events:blocked:${key}`,
      type: "security_events_identity_blocked",
      severity: c.class === "search" ? "high" : c.class === "training" ? "info" : "medium",
      title: `Cloudflare blocked or challenged ${b.count} request(s) claiming to be ${c.name} (24h)`,
      description: `Security events show mitigations for requests whose user-agent claims ${c.name}. These may be impersonators (expected to be blocked) or the real crawler. Security events alone do not prove the request was authentic.`,
      recommendation: "Check in Cloudflare Security Events whether the mitigated requests were flagged as verified bots. If verified traffic is being blocked, review the responsible rules.",
      evidence: { count: b.count, sample_paths: [...b.paths].slice(0, 10), rules: [...b.rules].slice(0, 10) },
      identities: [key],
    });
  }
}

async function runRobots(ctx: RunContext) {
  const url = `https://${ctx.zone.domain}/robots.txt`;
  try {
    const res = await safeFetch(url, { timeoutMs: 10_000, accept: "text/plain,*/*", maxBytes: 500_000 });
    if (res.status === 404) {
      ctx.findings.push({
        key: "robots:missing", type: "robots_missing", severity: "low",
        title: "robots.txt not found (404)",
        description: "Without robots.txt all crawlers are allowed by default and no sitemap is advertised.",
        recommendation: "Publish a robots.txt that reflects the client's crawler policy.",
        evidence: { final_url: res.finalUrl }, identities: [],
      });
      ctx.checks.push({ check: "robots_txt", status: "completed", detail: "robots.txt returned 404" });
      ctx.coveredPrefixes.push("robots:");
      return;
    }
    if (!res.ok) {
      ctx.checks.push({ check: "robots_txt", status: "failed", detail: `HTTP ${res.status} from ${res.finalUrl}` });
      return;
    }
    await snapshot(ctx, "robots_txt", { content: res.body, final_url: res.finalUrl });
    const analysis = analyzeRobots(res.body, ["/"]);
    ctx.findings.push(...analysis.findings);
    ctx.checks.push({
      check: "robots_txt",
      status: "completed",
      detail: `${analysis.sitemaps.length} sitemap(s); ${analysis.cloudflareManaged ? "Cloudflare-managed section present" : "no Cloudflare-managed section"}`,
    });
    ctx.coveredPrefixes.push("robots:");
  } catch (e) {
    ctx.checks.push({ check: "robots_txt", status: "failed", detail: e instanceof Error ? e.message : "Fetch failed" });
  }
}

/** Runs simulated user-agent requests against monitored URLs. */
export async function runAccessTests(
  db: SupabaseClient,
  zoneId: string,
  opts: { auditId?: string | null; urlIds?: string[]; identityKeys?: string[]; criticalOnly?: boolean } = {},
): Promise<{ tested: number; findings: DraftFinding[]; failed: boolean }> {
  let query = db.from("monitored_urls").select("id, url, label, is_critical").eq("zone_id", zoneId).eq("is_active", true);
  if (opts.urlIds?.length) query = query.in("id", opts.urlIds);
  if (opts.criticalOnly) query = query.eq("is_critical", true);
  const { data: urls, error } = await query;
  if (error) throw new Error(error.message);
  const identities = [
    { key: BASELINE_BROWSER.key, name: BASELINE_BROWSER.name, userAgent: BASELINE_BROWSER.userAgent, testType: "baseline_browser" as const },
    ...CRAWLERS.filter((c) => c.userAgent && (!opts.identityKeys || opts.identityKeys.includes(c.key))).map((c) => ({
      key: c.key, name: c.name, userAgent: c.userAgent!, testType: "simulated_user_agent" as const,
    })),
  ];
  const jobs = (urls ?? []).flatMap((u) => identities.map((i) => ({ u, i })));
  const results: { urlId: string; url: string; identity: string; name: string; result: string; status: number | null }[] = [];

  const worker = async () => {
    while (jobs.length) {
      const { u, i } = jobs.shift()!;
      const row: Record<string, unknown> = {
        zone_id: zoneId, monitored_url_id: u.id, audit_id: opts.auditId ?? null, target_url: u.url,
        identity_key: i.key, user_agent: i.userAgent, test_type: i.testType,
      };
      try {
        const res = await safeFetch(u.url, { userAgent: i.userAgent, timeoutMs: 8_000, maxBytes: 300_000 });
        const cls = classifyAccess({
          status: res.status, headers: res.headers, body: res.body,
          redirectChain: res.redirectChain, requestedUrl: u.url, finalUrl: res.finalUrl,
        });
        Object.assign(row, {
          http_status: res.status, response_time_ms: res.timeMs, final_url: res.finalUrl,
          redirect_chain: res.redirectChain, response_headers: sanitizeHeaders(res.headers),
          result: cls.result, challenge_detected: cls.challenge,
        });
      } catch (e) {
        const err = e as SafeFetchError;
        Object.assign(row, {
          result: err.kind === "timeout" ? "timeout" : "error",
          error_message: err.message?.slice(0, 500) ?? "Request failed",
          redirect_chain: err.redirectChain ?? [],
        });
      }
      results.push({ urlId: u.id, url: u.url, identity: i.key, name: i.name, result: row.result as string, status: (row.http_status as number) ?? null });
      const { error: insErr } = await db.from("cloudflare_access_tests").insert(row);
      if (insErr) console.error("[access-test] insert failed", insErr.message);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  // Compare each crawler to the baseline browser on the same URL, and to its previous result.
  const findings: DraftFinding[] = [];
  const bad = new Set(["blocked", "challenged"]);
  for (const r of results) {
    if (r.identity === BASELINE_BROWSER.key) {
      if (bad.has(r.result) || r.result === "error" || r.result === "timeout") {
        findings.push({
          key: `access:baseline:${r.urlId}`, type: "access_page_inaccessible", severity: "critical",
          title: `${r.url} is ${r.result} for a normal browser`,
          description: `A baseline browser request returned ${r.status ?? "no response"} (${r.result}). Real visitors may be affected. Note: tests run from EightSignal's server network, which Cloudflare may score differently from residential visitors.`,
          recommendation: "Load the page manually and check Cloudflare Security Events for this URL.",
          evidence: { url: r.url, status: r.status, result: r.result }, identities: [],
        });
      }
      continue;
    }
    const baseline = results.find((b) => b.urlId === r.urlId && b.identity === BASELINE_BROWSER.key);
    if (bad.has(r.result) && baseline && !bad.has(baseline.result)) {
      const c = CRAWLERS.find((x) => x.key === r.identity)!;
      findings.push({
        key: `access:identity:${r.identity}:${r.urlId}`, type: "access_identity_blocked",
        severity: c.class === "search" ? "high" : c.class === "training" ? "info" : "medium",
        title: `Simulated ${r.name} request to ${r.url} was ${r.result}`,
        description: `A request using ${r.name}'s user-agent was ${r.result} (HTTP ${r.status ?? "—"}) while a normal browser was not. This is a SIMULATED request from EightSignal's network — Cloudflare may legitimately block spoofed crawler user-agents that do not come from the provider's IP ranges. Confirm with Security Events whether verified ${r.name} traffic is affected.`,
        recommendation: "Check Security Events for verified-bot traffic from this identity before changing any rule.",
        evidence: { url: r.url, status: r.status, result: r.result, test_type: "simulated_user_agent" },
        identities: [r.identity],
      });
    }
  }
  // "Previously accessible, now blocked" detection.
  for (const r of results.filter((x) => bad.has(x.result) && x.identity !== BASELINE_BROWSER.key)) {
    const { data: prev } = await db
      .from("cloudflare_access_tests")
      .select("result, tested_at")
      .eq("zone_id", zoneId)
      .eq("monitored_url_id", r.urlId)
      .eq("identity_key", r.identity)
      .order("tested_at", { ascending: false })
      .range(1, 1)
      .maybeSingle();
    if (prev && prev.result === "accessible") {
      await db.from("cloudflare_config_changes").insert({
        zone_id: zoneId, configuration_type: "access", detection_source: "access_test",
        diff: [{ url: r.url, identity: r.identity, before: prev.result, after: r.result, previous_test_at: prev.tested_at }],
        potential_impact: `${r.name} was previously able to access ${r.url} and is now ${r.result}.`,
        recommended_action: "Identify what changed (WAF, bot settings, AI Crawl Control) and confirm it was intended.",
        severity: "high",
      });
      findings.push({
        key: `access:regression:${r.identity}:${r.urlId}`, type: "access_regression", severity: "high",
        title: `${r.name} lost access to ${r.url}`,
        description: `The previous test for this identity was accessible; it is now ${r.result}.`,
        recommendation: "Review recent configuration changes for this zone.",
        evidence: { url: r.url, before: prev.result, after: r.result }, identities: [r.identity],
      });
    }
  }
  const failed = results.length > 0 && results.every((r) => r.result === "error" || r.result === "timeout");
  return { tested: results.length, findings, failed };
}

async function persistFindings(ctx: RunContext) {
  const now = new Date().toISOString();
  const { data: open } = await ctx.db
    .from("cloudflare_findings")
    .select("id, finding_key, status")
    .eq("zone_id", ctx.zone.id)
    .in("status", ["open", "acknowledged"]);
  const openByKey = new Map((open ?? []).map((f) => [f.finding_key, f]));
  const seen = new Set<string>();
  for (const f of ctx.findings) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    const existing = openByKey.get(f.key);
    const payload = {
      audit_id: ctx.auditId, finding_type: f.type, severity: f.severity, title: f.title.slice(0, 300),
      description: f.description, recommendation: f.recommendation, evidence: f.evidence,
      affected_identities: f.identities, last_seen_at: now,
    };
    if (existing) {
      await ctx.db.from("cloudflare_findings").update(payload).eq("id", existing.id);
    } else {
      await ctx.db.from("cloudflare_findings").insert({ ...payload, zone_id: ctx.zone.id, finding_key: f.key, first_seen_at: now });
    }
  }
  // Auto-resolve findings from checks that completed in this run but no longer detect the issue.
  const stale = (open ?? []).filter(
    (f) => !seen.has(f.finding_key) && ctx.coveredPrefixes.some((p) => f.finding_key.startsWith(p)),
  );
  if (stale.length) {
    await ctx.db
      .from("cloudflare_findings")
      .update({ status: "resolved", resolved_at: now, evidence: { auto_resolved: true, reason: "No longer detected by audit" } })
      .in("id", stale.map((s) => s.id));
  }
}

export async function refreshZoneHealth(db: SupabaseClient, zoneId: string, checks?: CheckResult[]) {
  const [{ data: zone }, { data: findings }, { data: lastAudit }] = await Promise.all([
    db.from("cloudflare_zones").select("id, cloudflare_account_id, last_audited_at, cloudflare_accounts(connection_status)").eq("id", zoneId).single(),
    db.from("cloudflare_findings").select("severity").eq("zone_id", zoneId).in("status", ["open", "acknowledged"]),
    db.from("cloudflare_audits").select("checks, completed_at").eq("zone_id", zoneId).eq("audit_type", "full").in("status", ["completed", "partial"]).order("executed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!zone) return;
  const account = zone.cloudflare_accounts as unknown as { connection_status: string } | null;
  const health = computeHealth({
    connected: account?.connection_status === "connected",
    lastAuditAt: lastAudit?.completed_at ?? null,
    checks: (checks ?? (lastAudit?.checks as CheckResult[] | undefined)) ?? [],
    openFindingSeverities: (findings ?? []).map((f) => f.severity as Severity),
  });
  await db.from("cloudflare_zones").update({ health_status: health.status, health_reason: health.reason }).eq("id", zoneId);
  return health;
}

/**
 * Full read-only audit of one zone. `db` must be the service-role client and the
 * caller must already have verified that the user is an editor (or the cron secret).
 */
export async function runZoneAudit(
  db: SupabaseClient,
  zoneId: string,
  opts: { trigger: "manual" | "scheduled"; userId: string | null },
): Promise<AuditSummary> {
  const { data: zone, error } = await db
    .from("cloudflare_zones")
    .select("id, domain, zone_identifier, cloudflare_account_id, client_id")
    .eq("id", zoneId)
    .single();
  if (error || !zone) throw new Error("Zone not found");

  const { data: audit, error: auditErr } = await db
    .from("cloudflare_audits")
    .insert({ zone_id: zoneId, audit_type: "full", status: "running", trigger: opts.trigger, executed_by: opts.userId })
    .select("id")
    .single();
  if (auditErr || !audit) throw new Error(`Could not start audit: ${auditErr?.message}`);

  const ctx: RunContext = { db, zone, auditId: audit.id, checks: [], findings: [], coveredPrefixes: [], changes: 0 };
  let fatal: string | null = null;
  try {
    let accountIdentifier: string | null = null;
    let token: string | null = null;
    if (zone.cloudflare_account_id) {
      const { data: account } = await db.from("cloudflare_accounts").select("account_identifier").eq("id", zone.cloudflare_account_id).single();
      accountIdentifier = account?.account_identifier ?? null;
      token = await resolveToken(db, zone.cloudflare_account_id);
    }
    if (!token) {
      ctx.checks.push({ check: "api_connection", status: "skipped", detail: "No Cloudflare API token configured for this zone's account" });
    } else {
      const client = new CloudflareReadOnlyClient(token);
      const verify = await client.verifyToken(accountIdentifier);
      await db.from("cloudflare_accounts").update({
        connection_status: verify.ok && verify.data.status === "active" ? "connected" : "error",
        connection_checked_at: new Date().toISOString(),
        connection_error: verify.ok ? null : unavailable(verify),
      }).eq("id", zone.cloudflare_account_id!);
      if (!verify.ok || verify.data.status !== "active") {
        ctx.checks.push({ check: "api_connection", status: "failed", detail: verify.ok ? `Token status: ${verify.data.status}` : unavailable(verify) });
      } else {
        let cfZoneId = zone.zone_identifier;
        if (!cfZoneId) {
          const found = await client.listZones(zone.domain);
          if (found.ok && found.data[0]) {
            cfZoneId = found.data[0].id;
            await db.from("cloudflare_zones").update({ zone_identifier: cfZoneId, plan_name: found.data[0].plan?.name ?? null }).eq("id", zone.id);
          }
        } else {
          const z = await client.getZone(cfZoneId);
          if (z.ok) await db.from("cloudflare_zones").update({ plan_name: z.data.plan?.name ?? null }).eq("id", zone.id);
        }
        if (!cfZoneId) {
          ctx.checks.push({ check: "api_connection", status: "failed", detail: `Zone ${zone.domain} not visible to this token (needs Zone Read)` });
        } else {
          ctx.checks.push({ check: "api_connection", status: "completed", detail: "Token verified (read-only usage)" });
          await runConfigChecks(ctx, client, cfZoneId, accountIdentifier);
        }
      }
    }

    await runRobots(ctx);

    const access = await runAccessTests(db, zoneId, { auditId: audit.id, criticalOnly: true });
    ctx.findings.push(...access.findings);
    if (access.tested === 0) {
      ctx.checks.push({ check: "access_tests", status: "skipped", detail: "No critical monitored URLs registered" });
    } else if (access.failed) {
      ctx.checks.push({ check: "access_tests", status: "failed", detail: "Every access request failed (network or DNS)" });
    } else {
      ctx.checks.push({ check: "access_tests", status: "completed", detail: `${access.tested} request(s) across critical URLs` });
      ctx.coveredPrefixes.push("access:");
    }

    await persistFindings(ctx);
  } catch (e) {
    fatal = e instanceof Error ? e.message : "Audit failed";
  }

  const completedChecks = ctx.checks.filter((c) => c.status === "completed").length;
  const status: AuditSummary["status"] = fatal ? "failed" : completedChecks === ctx.checks.length ? "completed" : completedChecks > 0 ? "partial" : "failed";
  const now = new Date().toISOString();
  const recommendations = [...new Set(ctx.findings.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK.medium).map((f) => f.recommendation))];
  await db.from("cloudflare_audits").update({
    status,
    checks: ctx.checks,
    findings: ctx.findings.map((f) => ({ key: f.key, severity: f.severity, title: f.title })),
    recommendations,
    error_message: fatal,
    completed_at: now,
  }).eq("id", audit.id);
  if (status !== "failed") await db.from("cloudflare_zones").update({ last_audited_at: now }).eq("id", zoneId);
  const health = await refreshZoneHealth(db, zoneId, ctx.checks);
  await logActivity(db, {
    userId: opts.userId, action: "cloudflare.audit", entityType: "cloudflare_zone", entityId: zoneId,
    metadata: { audit_id: audit.id, status, trigger: opts.trigger, findings: ctx.findings.length, changes: ctx.changes },
  });
  return { auditId: audit.id, status, checks: ctx.checks, findings: ctx.findings.length, changes: ctx.changes, health: health?.status ?? "unknown" };
}
