-- EightSignal Cloudflare Monitor schema (read-only / advisory mode)

create table public.cloudflare_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  account_name text not null,
  account_identifier text,  -- Cloudflare account ID (not secret)
  connection_status text not null default 'not_connected'
    check (connection_status in ('not_connected', 'connected', 'error', 'revoked')),
  connection_checked_at timestamptz,
  connection_error text,
  token_scopes_observed jsonb not null default '[]'::jsonb,  -- capability probe results
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cloudflare_accounts_client_idx on public.cloudflare_accounts (client_id);
create trigger cloudflare_accounts_updated_at before update on public.cloudflare_accounts
  for each row execute function public.set_updated_at();

-- Secret material. NO RLS policies are defined on this table, so it is reachable
-- only with the service role key from server-side code. Tokens are AES-256-GCM
-- encrypted with CLOUDFLARE_CREDENTIALS_KEY before they reach the database, or
-- the row references a server environment variable by name instead.
create table public.cloudflare_credentials (
  cloudflare_account_id uuid primary key references public.cloudflare_accounts (id) on delete cascade,
  storage text not null check (storage in ('encrypted', 'env')),
  encrypted_token text,        -- base64(iv | tag | ciphertext)
  env_var_name text check (env_var_name ~ '^CLOUDFLARE_TOKEN_[A-Z0-9_]+$'),
  token_hint text,             -- last 4 characters only, for display
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  check (
    (storage = 'encrypted' and encrypted_token is not null and env_var_name is null)
    or (storage = 'env' and env_var_name is not null and encrypted_token is null)
  )
);

create table public.cloudflare_zones (
  id uuid primary key default gen_random_uuid(),
  cloudflare_account_id uuid references public.cloudflare_accounts (id) on delete set null,
  client_id uuid not null references public.clients (id) on delete cascade,
  zone_identifier text,  -- Cloudflare zone ID
  domain text not null check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+$'),
  monitoring_enabled boolean not null default true,
  plan_name text,
  health_status text not null default 'not_connected'
    check (health_status in ('healthy', 'needs_review', 'warning', 'critical', 'not_connected')),
  health_reason text,
  last_audited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cloudflare_zones_domain_key on public.cloudflare_zones (domain);
create index cloudflare_zones_client_idx on public.cloudflare_zones (client_id);
create trigger cloudflare_zones_updated_at before update on public.cloudflare_zones
  for each row execute function public.set_updated_at();

-- Important URLs registered for accessibility testing.
create table public.monitored_urls (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.cloudflare_zones (id) on delete cascade,
  url text not null check (url ~ '^https?://'),
  label text,
  page_type text not null default 'page'
    check (page_type in ('homepage', 'service', 'landing', 'blog', 'resource', 'sitemap', 'robots', 'page')),
  is_critical boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (zone_id, url)
);

create table public.cloudflare_audits (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.cloudflare_zones (id) on delete cascade,
  audit_type text not null
    check (audit_type in ('full', 'waf', 'redirects', 'bot_settings', 'robots', 'access', 'security_events', 'audit_log')),
  status text not null
    check (status in ('running', 'completed', 'partial', 'failed', 'unavailable')),
  trigger text not null default 'manual' check (trigger in ('manual', 'scheduled')),
  findings jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  checks jsonb not null default '[]'::jsonb,  -- per-check status: completed / unavailable / manual_verification
  error_message text,
  executed_by uuid references public.profiles (id) on delete set null,
  executed_at timestamptz not null default now(),
  completed_at timestamptz
);
create index cloudflare_audits_zone_idx on public.cloudflare_audits (zone_id, executed_at desc);

create table public.cloudflare_config_snapshots (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.cloudflare_zones (id) on delete cascade,
  audit_id uuid references public.cloudflare_audits (id) on delete set null,
  configuration_type text not null
    check (configuration_type in ('waf_custom_rules', 'redirect_rules', 'bot_management', 'robots_txt', 'page_rules', 'rate_limit_rules')),
  configuration_data jsonb not null,
  configuration_hash text not null,
  captured_at timestamptz not null default now()
);
create index cloudflare_snapshots_zone_type_idx
  on public.cloudflare_config_snapshots (zone_id, configuration_type, captured_at desc);

create table public.cloudflare_config_changes (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.cloudflare_zones (id) on delete cascade,
  configuration_type text not null,
  previous_snapshot_id uuid references public.cloudflare_config_snapshots (id) on delete set null,
  current_snapshot_id uuid references public.cloudflare_config_snapshots (id) on delete set null,
  previous_configuration jsonb,
  current_configuration jsonb,
  diff jsonb not null default '[]'::jsonb,
  detection_source text not null default 'snapshot_diff'
    check (detection_source in ('snapshot_diff', 'audit_log', 'access_test', 'manual')),
  potential_impact text,
  recommended_action text,
  severity text not null default 'info'
    check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  acknowledged boolean not null default false,
  acknowledged_by uuid references public.profiles (id) on delete set null,
  detected_at timestamptz not null default now()
);
create index cloudflare_changes_zone_idx on public.cloudflare_config_changes (zone_id, detected_at desc);

create table public.cloudflare_findings (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.cloudflare_zones (id) on delete cascade,
  audit_id uuid references public.cloudflare_audits (id) on delete set null,
  finding_key text not null,  -- stable key for de-duplicating repeat detections
  finding_type text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  title text not null,
  description text not null,
  recommendation text,
  evidence jsonb not null default '{}'::jsonb,
  affected_identities text[] not null default '{}',
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'false_positive', 'accepted_risk')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);
create unique index cloudflare_findings_key on public.cloudflare_findings (zone_id, finding_key)
  where status in ('open', 'acknowledged');
create index cloudflare_findings_zone_status_idx on public.cloudflare_findings (zone_id, status, severity);

alter table public.actions
  add constraint actions_cloudflare_finding_fk
  foreign key (cloudflare_finding_id) references public.cloudflare_findings (id) on delete set null;

create table public.cloudflare_access_tests (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.cloudflare_zones (id) on delete cascade,
  monitored_url_id uuid references public.monitored_urls (id) on delete set null,
  audit_id uuid references public.cloudflare_audits (id) on delete set null,
  target_url text not null,
  identity_key text not null,     -- crawler registry key, e.g. 'gptbot' or 'browser'
  user_agent text not null,
  test_type text not null default 'simulated_user_agent'
    check (test_type in ('simulated_user_agent', 'baseline_browser')),
  http_status integer,
  response_time_ms integer,
  final_url text,
  redirect_chain jsonb not null default '[]'::jsonb,
  response_headers jsonb not null default '{}'::jsonb,
  result text not null
    check (result in ('accessible', 'redirected', 'challenged', 'blocked', 'error', 'timeout')),
  challenge_detected boolean not null default false,
  error_message text,
  tested_at timestamptz not null default now()
);
create index cloudflare_access_tests_zone_idx on public.cloudflare_access_tests (zone_id, tested_at desc);

-- Per-identity Cloudflare policy as observed. Where Cloudflare's API does not expose
-- the per-crawler setting, an analyst records it manually ('manual' source), and the
-- UI shows it as manually verified rather than API-confirmed.
create table public.cloudflare_crawler_policies (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.cloudflare_zones (id) on delete cascade,
  identity_key text not null,
  policy text not null check (policy in ('allow', 'block', 'challenge', 'unknown', 'not_configured')),
  policy_source text not null check (policy_source in ('api', 'manual')),
  observed_access text,           -- free text / last access-test result
  last_observed_activity_at timestamptz,
  notes text,
  verified_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (zone_id, identity_key)
);

create table public.cloudflare_incidents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  zone_id uuid references public.cloudflare_zones (id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  incident_type text not null default 'investigation'
    check (incident_type in ('suspicious_admin_activity', 'unauthorized_config_change', 'suspicious_redirect', 'unexpected_traffic', 'investigation', 'other')),
  description text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  incident_date date not null,
  resolution_notes text,
  status text not null default 'open'
    check (status in ('open', 'investigating', 'contained', 'resolved', 'closed')),
  reported_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cloudflare_incidents_client_idx on public.cloudflare_incidents (client_id, incident_date desc);
create trigger cloudflare_incidents_updated_at before update on public.cloudflare_incidents
  for each row execute function public.set_updated_at();
