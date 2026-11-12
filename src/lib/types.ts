/** Row shapes for the Supabase tables (kept in sync with supabase/migrations). */

export type Role = "admin" | "analyst" | "viewer" | "pending";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
}

export interface Client {
  id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
  platform: string | null;
  hosting_provider: string | null;
  cdn_provider: string | null;
  technology_stack: string[];
  active_services: string[];
  notes: string | null;
  created_at: string;
}

export interface Source {
  id: string;
  name: string;
  provider: string;
  source_url: string;
  source_type: "rss" | "atom" | "changelog_page" | "announcement_page" | "api" | "manual";
  config: { link_pattern?: string; max_items?: number } & Record<string, unknown>;
  default_category: string | null;
  is_active: boolean;
  check_interval_minutes: number;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  notes: string | null;
}

export interface IntelligenceItem {
  id: string;
  title: string;
  slug: string;
  provider: string;
  category: string;
  source_id: string | null;
  source_url: string | null;
  canonical_url: string | null;
  published_at: string | null;
  discovered_at: string;
  raw_content: string | null;
  summary: string | null;
  impact_level: string;
  status: string;
  analysis_status: "pending" | "running" | "completed" | "failed" | "skipped";
  analysis_error: string | null;
  entry_method: "manual" | "url_submission" | "ingestion";
  content_fingerprint: string;
  created_at: string;
  updated_at: string;
}

export interface RecommendedAction {
  title: string;
  description: string;
  department: string;
  priority: "critical" | "high" | "medium" | "low";
}

export interface AffectedClient {
  client_name: string;
  reason: string;
  recommended_action: string;
}

export interface AiAnalysis {
  id: string;
  intelligence_id: string;
  what_happened: string;
  why_it_matters: string;
  affected_teams: string[];
  departments: string[];
  risk_assessment: string;
  opportunity_assessment: string;
  recommended_actions: RecommendedAction[];
  affected_clients: AffectedClient[];
  impact_level: string;
  confidence_score: number;
  confidence_rationale: string;
  source_classification: string;
  summary: string;
  model: string;
  analyzed_at: string;
  is_current: boolean;
}

export interface ActionRow {
  id: string;
  intelligence_id: string | null;
  client_id: string | null;
  cloudflare_finding_id: string | null;
  title: string;
  description: string | null;
  department: string | null;
  assigned_to: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
}

export type HealthStatus = "healthy" | "needs_review" | "warning" | "critical" | "not_connected";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface CloudflareZone {
  id: string;
  cloudflare_account_id: string | null;
  client_id: string;
  zone_identifier: string | null;
  domain: string;
  monitoring_enabled: boolean;
  plan_name: string | null;
  health_status: HealthStatus;
  health_reason: string | null;
  last_audited_at: string | null;
}

export interface CloudflareFinding {
  id: string;
  zone_id: string;
  audit_id: string | null;
  finding_key: string;
  finding_type: string;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string | null;
  evidence: Record<string, unknown>;
  affected_identities: string[];
  status: "open" | "acknowledged" | "resolved" | "false_positive" | "accepted_risk";
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface CheckResult {
  check: string;
  status: "completed" | "unavailable" | "failed" | "manual_verification" | "skipped";
  detail?: string;
}
