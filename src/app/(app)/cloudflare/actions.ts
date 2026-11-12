"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEditor, requireAdmin, AuthorizationError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorMessage, type ActionState } from "@/lib/action-state";
import { logActivity } from "@/lib/activity";
import { validateTokenShape } from "@/lib/cloudflare/credentials";
import { encryptToken } from "@/lib/cloudflare/token";
import { CloudflareReadOnlyClient } from "@/lib/cloudflare/api";
import { refreshZoneHealth, runAccessTests, runZoneAudit } from "@/lib/cloudflare/runner";
import { CRAWLERS } from "@/lib/cloudflare/crawlers";
import { validateOutboundUrl } from "@/lib/security/ip";

function fail(e: unknown): ActionState {
  if (e instanceof z.ZodError) return { error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join(" · ") };
  if (e instanceof AuthorizationError) return { error: e.message };
  return { error: errorMessage(e) };
}
const uuid = z.string().uuid();

// ---------------------------------------------------------------------------
// Accounts & credentials
// ---------------------------------------------------------------------------
const AccountSchema = z.object({
  client_id: uuid,
  account_name: z.string().trim().min(2).max(200),
  account_identifier: z.string().trim().regex(/^[a-f0-9]{32}$/i, "Cloudflare account IDs are 32 hex characters").optional().or(z.literal("")),
});

export async function createAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const input = AccountSchema.parse(Object.fromEntries(formData));
    const { data, error } = await db
      .from("cloudflare_accounts")
      .insert({ ...input, account_identifier: input.account_identifier || null, created_by: user.id })
      .select("id")
      .single();
    if (error) return { error: error.message };
    await logActivity(db, { userId: user.id, action: "cloudflare.account.create", entityType: "cloudflare_account", entityId: data.id });
    revalidatePath("/cloudflare/setup");
    return { ok: true, message: "Cloudflare account registered. Add a scoped API token next." };
  } catch (e) {
    return fail(e);
  }
}

const CredentialSchema = z.discriminatedUnion("storage", [
  z.object({ storage: z.literal("encrypted"), account_id: uuid, token: z.string().min(1, "Token is required") }),
  z.object({
    storage: z.literal("env"),
    account_id: uuid,
    env_var_name: z.string().trim().regex(/^CLOUDFLARE_TOKEN_[A-Z0-9_]+$/, "Must look like CLOUDFLARE_TOKEN_BLEND360"),
  }),
]);

/** Stores a scoped API token (admin only). The token never returns to the browser. */
export async function saveCredential(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user, db } = await requireAdmin();
    const input = CredentialSchema.parse(Object.fromEntries(formData));
    const admin = createAdminClient();
    let row: Record<string, unknown>;
    let token: string | undefined;
    if (input.storage === "encrypted") {
      const shapeError = validateTokenShape(input.token);
      if (shapeError) return { error: shapeError };
      token = input.token.trim();
      row = { storage: "encrypted", encrypted_token: encryptToken(token), env_var_name: null, token_hint: token.slice(-4) };
    } else {
      token = process.env[input.env_var_name];
      if (!token) return { error: `${input.env_var_name} is not set in the server environment.` };
      row = { storage: "env", env_var_name: input.env_var_name, encrypted_token: null, token_hint: token.slice(-4) };
    }
    const { data: account } = await admin.from("cloudflare_accounts").select("account_identifier").eq("id", input.account_id).single();
    const verify = await new CloudflareReadOnlyClient(token).verifyToken(account?.account_identifier);
    const { error } = await admin
      .from("cloudflare_credentials")
      .upsert({ cloudflare_account_id: input.account_id, ...row, created_by: user.id, rotated_at: new Date().toISOString() });
    if (error) return { error: error.message };
    await admin.from("cloudflare_accounts").update({
      connection_status: verify.ok && verify.data.status === "active" ? "connected" : "error",
      connection_checked_at: new Date().toISOString(),
      connection_error: verify.ok ? null : verify.message,
    }).eq("id", input.account_id);
    await logActivity(db, {
      userId: user.id, action: "cloudflare.credential.save", entityType: "cloudflare_account", entityId: input.account_id,
      metadata: { storage: input.storage, verified: verify.ok },
    });
    revalidatePath("/cloudflare/setup");
    revalidatePath("/cloudflare");
    return verify.ok
      ? { ok: true, message: `Token stored (…${row.token_hint}) and verified as ${verify.data.status}.` }
      : { ok: true, message: `Token stored (…${row.token_hint}) but verification failed: ${verify.message}` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeCredential(formData: FormData) {
  const { user, db } = await requireAdmin();
  const id = uuid.parse(formData.get("account_id"));
  const admin = createAdminClient();
  await admin.from("cloudflare_credentials").delete().eq("cloudflare_account_id", id);
  await admin.from("cloudflare_accounts").update({ connection_status: "revoked" }).eq("id", id);
  await logActivity(db, { userId: user.id, action: "cloudflare.credential.remove", entityType: "cloudflare_account", entityId: id });
  revalidatePath("/cloudflare/setup");
}

// ---------------------------------------------------------------------------
// Zones & monitored URLs
// ---------------------------------------------------------------------------
const ZoneSchema = z.object({
  client_id: uuid,
  cloudflare_account_id: uuid.optional().or(z.literal("")),
  domain: z.string().trim().toLowerCase().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Enter a bare domain like blend360.com"),
  zone_identifier: z.string().trim().regex(/^[a-f0-9]{32}$/i, "Zone IDs are 32 hex characters").optional().or(z.literal("")),
});

export async function createZone(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const input = ZoneSchema.parse(Object.fromEntries(formData));
    const { data, error } = await db
      .from("cloudflare_zones")
      .insert({
        client_id: input.client_id,
        cloudflare_account_id: input.cloudflare_account_id || null,
        domain: input.domain.replace(/^www\./, ""),
        zone_identifier: input.zone_identifier || null,
      })
      .select("id, domain")
      .single();
    if (error) return { error: error.code === "23505" ? "That domain is already registered." : error.message };
    // Default monitored URLs: homepage, robots.txt, sitemap.
    await db.from("monitored_urls").insert([
      { zone_id: data.id, url: `https://${data.domain}/`, label: "Homepage", page_type: "homepage", is_critical: true },
      { zone_id: data.id, url: `https://${data.domain}/robots.txt`, label: "robots.txt", page_type: "robots", is_critical: true },
      { zone_id: data.id, url: `https://${data.domain}/sitemap.xml`, label: "Sitemap", page_type: "sitemap", is_critical: true },
    ]);
    await logActivity(db, { userId: user.id, action: "cloudflare.zone.create", entityType: "cloudflare_zone", entityId: data.id });
    revalidatePath("/cloudflare");
    return { ok: true, message: `${data.domain} registered.`, href: `/cloudflare/zones/${data.id}` };
  } catch (e) {
    return fail(e);
  }
}

export async function setZoneAccount(formData: FormData) {
  const { db, user } = await requireEditor();
  const zoneId = uuid.parse(formData.get("zone_id"));
  const accountId = formData.get("cloudflare_account_id");
  await db.from("cloudflare_zones").update({ cloudflare_account_id: accountId ? uuid.parse(accountId) : null }).eq("id", zoneId);
  await logActivity(db, { userId: user.id, action: "cloudflare.zone.update", entityType: "cloudflare_zone", entityId: zoneId });
  revalidatePath(`/cloudflare/zones/${zoneId}`);
}

export async function toggleZoneMonitoring(formData: FormData) {
  const { db } = await requireEditor();
  const zoneId = uuid.parse(formData.get("zone_id"));
  const enabled = formData.get("enabled") === "1";
  await db.from("cloudflare_zones").update({ monitoring_enabled: enabled }).eq("id", zoneId);
  revalidatePath(`/cloudflare/zones/${zoneId}`);
  revalidatePath("/cloudflare");
}

const UrlSchema = z.object({
  zone_id: uuid,
  url: z.string().trim().url(),
  label: z.string().trim().max(120).optional(),
  page_type: z.enum(["homepage", "service", "landing", "blog", "resource", "sitemap", "robots", "page"]),
  is_critical: z.string().optional(),
});

export async function addMonitoredUrl(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db } = await requireEditor();
    const input = UrlSchema.parse(Object.fromEntries(formData));
    const check = validateOutboundUrl(input.url);
    if (!check.ok) return { error: check.reason };
    const { data: zone } = await db.from("cloudflare_zones").select("domain").eq("id", input.zone_id).single();
    const host = check.url.hostname;
    if (!zone || !(host === zone.domain || host.endsWith(`.${zone.domain}`))) {
      return { error: `URL must be on ${zone?.domain ?? "the zone's domain"}.` };
    }
    const { error } = await db.from("monitored_urls").insert({
      zone_id: input.zone_id, url: check.url.toString(), label: input.label || null,
      page_type: input.page_type, is_critical: input.is_critical === "on",
    });
    if (error) return { error: error.code === "23505" ? "That URL is already monitored." : error.message };
    revalidatePath(`/cloudflare/zones/${input.zone_id}`);
    return { ok: true, message: "URL added." };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMonitoredUrl(formData: FormData) {
  const { db } = await requireEditor();
  const id = uuid.parse(formData.get("id"));
  const { data } = await db.from("monitored_urls").update({ is_active: false }).eq("id", id).select("zone_id").single();
  if (data) revalidatePath(`/cloudflare/zones/${data.zone_id}`);
}

// ---------------------------------------------------------------------------
// Audits & tests (read-only against Cloudflare)
// ---------------------------------------------------------------------------
export async function runAudit(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user } = await requireEditor();
    const zoneId = uuid.parse(formData.get("zone_id"));
    const summary = await runZoneAudit(createAdminClient(), zoneId, { trigger: "manual", userId: user.id });
    revalidatePath(`/cloudflare/zones/${zoneId}`);
    revalidatePath("/cloudflare");
    const done = summary.checks.filter((c) => c.status === "completed").length;
    return {
      ok: summary.status !== "failed",
      message: `Audit ${summary.status}: ${done}/${summary.checks.length} checks completed, ${summary.findings} finding(s), ${summary.changes} change(s). Status: ${summary.health.replace("_", " ")}.`,
      error: summary.status === "failed" ? "Audit failed — see the check list for details." : undefined,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function runAccessTestsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user, db } = await requireEditor();
    const zoneId = uuid.parse(formData.get("zone_id"));
    const identity = formData.get("identity");
    const identityKeys = identity && identity !== "all" ? [z.enum(CRAWLERS.map((c) => c.key) as [string, ...string[]]).parse(identity)] : undefined;
    const res = await runAccessTests(createAdminClient(), zoneId, { identityKeys });
    await logActivity(db, { userId: user.id, action: "cloudflare.access_test", entityType: "cloudflare_zone", entityId: zoneId, metadata: { tested: res.tested } });
    revalidatePath(`/cloudflare/zones/${zoneId}`);
    if (!res.tested) return { error: "No active monitored URLs to test." };
    return { ok: true, message: `${res.tested} simulated request(s) completed; ${res.findings.length} potential issue(s). Run a full audit to record findings.` };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Findings, policies, changes
// ---------------------------------------------------------------------------
export async function updateFindingStatus(formData: FormData) {
  const { db, user } = await requireEditor();
  const id = uuid.parse(formData.get("id"));
  const status = z.enum(["open", "acknowledged", "resolved", "false_positive", "accepted_risk"]).parse(formData.get("status"));
  const closed = ["resolved", "false_positive", "accepted_risk"].includes(status);
  const { data } = await db
    .from("cloudflare_findings")
    .update({ status, resolved_at: closed ? new Date().toISOString() : null, resolved_by: closed ? user.id : null })
    .eq("id", id)
    .select("zone_id")
    .single();
  await logActivity(db, { userId: user.id, action: "cloudflare.finding.status", entityType: "cloudflare_finding", entityId: id, metadata: { status } });
  if (data) {
    await refreshZoneHealth(createAdminClient(), data.zone_id);
    revalidatePath(`/cloudflare/zones/${data.zone_id}`);
    revalidatePath("/cloudflare");
  }
}

export async function createTaskFromFinding(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const id = uuid.parse(formData.get("finding_id"));
    const { data: f } = await db
      .from("cloudflare_findings")
      .select("id, title, description, recommendation, severity, zone_id, cloudflare_zones(client_id, domain)")
      .eq("id", id)
      .single();
    if (!f) return { error: "Finding not found." };
    const zone = f.cloudflare_zones as unknown as { client_id: string; domain: string };
    const { data, error } = await db.from("actions").insert({
      title: `[${zone.domain}] ${f.title}`.slice(0, 300),
      description: `${f.description}\n\nRecommendation: ${f.recommendation ?? "—"}\n\nEightSignal is read-only: apply any Cloudflare change manually after approval.`,
      priority: f.severity === "info" ? "low" : f.severity,
      department: "Security",
      client_id: zone.client_id,
      cloudflare_finding_id: f.id,
      created_by: user.id,
    }).select("id").single();
    if (error) return { error: error.message };
    await db.from("cloudflare_findings").update({ status: "acknowledged" }).eq("id", f.id).eq("status", "open");
    revalidatePath(`/cloudflare/zones/${f.zone_id}`);
    return { ok: true, message: "Task created.", href: `/actions/${data.id}` };
  } catch (e) {
    return fail(e);
  }
}

const PolicySchema = z.object({
  zone_id: uuid,
  identity_key: z.enum(CRAWLERS.map((c) => c.key) as [string, ...string[]]),
  policy: z.enum(["allow", "block", "challenge", "unknown", "not_configured"]),
  notes: z.string().trim().max(1000).optional(),
});

/** Records a manually verified per-crawler Cloudflare policy (from the dashboard). */
export async function recordCrawlerPolicy(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const input = PolicySchema.parse(Object.fromEntries(formData));
    const { error } = await db.from("cloudflare_crawler_policies").upsert(
      { ...input, notes: input.notes || null, policy_source: "manual", verified_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: "zone_id,identity_key" },
    );
    if (error) return { error: error.message };
    await logActivity(db, { userId: user.id, action: "cloudflare.policy.record", entityType: "cloudflare_zone", entityId: input.zone_id, metadata: { identity: input.identity_key, policy: input.policy } });
    revalidatePath(`/cloudflare/zones/${input.zone_id}`);
    return { ok: true, message: "Policy recorded as manually verified." };
  } catch (e) {
    return fail(e);
  }
}

export async function acknowledgeChange(formData: FormData) {
  const { db, user } = await requireEditor();
  const id = uuid.parse(formData.get("id"));
  const { data } = await db.from("cloudflare_config_changes").update({ acknowledged: true, acknowledged_by: user.id }).eq("id", id).select("zone_id").single();
  if (data) revalidatePath(`/cloudflare/zones/${data.zone_id}`);
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------
const IncidentSchema = z.object({
  client_id: uuid,
  zone_id: uuid.optional().or(z.literal("")),
  title: z.string().trim().min(3).max(300),
  incident_type: z.enum(["suspicious_admin_activity", "unauthorized_config_change", "suspicious_redirect", "unexpected_traffic", "investigation", "other"]),
  description: z.string().trim().min(3).max(20_000),
  severity: z.enum(["critical", "high", "medium", "low"]),
  incident_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["open", "investigating", "contained", "resolved", "closed"]),
  resolution_notes: z.string().trim().max(20_000).optional(),
});

export async function saveIncident(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();
    const id = formData.get("id");
    const input = IncidentSchema.parse(Object.fromEntries(formData));
    const row = { ...input, zone_id: input.zone_id || null, resolution_notes: input.resolution_notes || null };
    const res = id
      ? await db.from("cloudflare_incidents").update(row).eq("id", uuid.parse(id)).select("id").single()
      : await db.from("cloudflare_incidents").insert({ ...row, reported_by: user.id }).select("id").single();
    if (res.error) return { error: res.error.message };
    await logActivity(db, { userId: user.id, action: id ? "incident.update" : "incident.create", entityType: "cloudflare_incident", entityId: res.data.id });
    revalidatePath("/cloudflare/incidents");
    return { ok: true, message: id ? "Incident updated." : "Incident recorded." };
  } catch (e) {
    return fail(e);
  }
}
