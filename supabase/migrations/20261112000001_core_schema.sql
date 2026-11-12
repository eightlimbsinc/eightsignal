-- EightSignal core schema
-- Version-controlled migration. Apply with `supabase db push` or psql (see README).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerations (as CHECK-constrained text for easy evolution)
-- ---------------------------------------------------------------------------

-- Shared updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles & access control
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'pending'
    check (role in ('admin', 'analyst', 'viewer', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Email domains whose users are automatically granted the 'viewer' role at sign-up.
-- Everyone else lands as 'pending' and must be approved by an admin.
create table public.allowed_email_domains (
  domain text primary key check (domain = lower(domain) and domain !~ '@'),
  default_role text not null default 'viewer' check (default_role in ('analyst', 'viewer')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := 'pending';
  v_domain text := lower(split_part(new.email, '@', 2));
begin
  select d.default_role into v_role
  from public.allowed_email_domains d
  where d.domain = v_domain;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(v_role, 'pending')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helpers. SECURITY DEFINER so they can read profiles regardless of RLS;
-- they only ever reveal the caller's own role.
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('admin', 'analyst', 'viewer') from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('admin', 'analyst') from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Prevent non-admins from escalating their own role.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only administrators can change roles';
  end if;
  if new.email is distinct from old.email and auth.uid() is not null then
    raise exception 'Email is managed by authentication';
  end if;
  return new;
end;
$$;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  website_url text,
  industry text,
  platform text,              -- CMS / platform
  hosting_provider text,
  cdn_provider text,
  technology_stack text[] not null default '{}',
  active_services text[] not null default '{}',
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index clients_name_key on public.clients (lower(name));
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Sources & intelligence
-- ---------------------------------------------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null,
  source_url text not null,
  source_type text not null
    check (source_type in ('rss', 'atom', 'changelog_page', 'announcement_page', 'api', 'manual')),
  config jsonb not null default '{}'::jsonb,
  default_category text,
  is_active boolean not null default false,
  check_interval_minutes integer not null default 360 check (check_interval_minutes >= 15),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sources_url_key on public.sources (source_url);
create index sources_provider_idx on public.sources (provider);
create trigger sources_updated_at before update on public.sources
  for each row execute function public.set_updated_at();

create table public.intelligence_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  slug text not null,
  provider text not null,
  category text not null,
  source_id uuid references public.sources (id) on delete set null,
  source_url text,
  canonical_url text,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  raw_content text,
  summary text,
  impact_level text not null default 'unassessed'
    check (impact_level in ('critical', 'high', 'medium', 'low', 'informational', 'unassessed')),
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'actioned', 'monitoring', 'archived', 'dismissed')),
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  analysis_error text,
  entry_method text not null default 'manual'
    check (entry_method in ('manual', 'url_submission', 'ingestion')),
  content_fingerprint text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index intelligence_canonical_url_key
  on public.intelligence_items (canonical_url) where canonical_url is not null;
create unique index intelligence_fingerprint_key on public.intelligence_items (content_fingerprint);
create unique index intelligence_slug_key on public.intelligence_items (slug);
create index intelligence_provider_idx on public.intelligence_items (provider);
create index intelligence_category_idx on public.intelligence_items (category);
create index intelligence_impact_idx on public.intelligence_items (impact_level);
create index intelligence_status_idx on public.intelligence_items (status);
create index intelligence_published_idx on public.intelligence_items (published_at desc nulls last);
create index intelligence_discovered_idx on public.intelligence_items (discovered_at desc);
create index intelligence_search_idx on public.intelligence_items
  using gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '')));
create trigger intelligence_items_updated_at before update on public.intelligence_items
  for each row execute function public.set_updated_at();

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  intelligence_id uuid not null references public.intelligence_items (id) on delete cascade,
  what_happened text not null,
  why_it_matters text not null,
  affected_teams text[] not null default '{}',
  departments text[] not null default '{}',
  risk_assessment text not null,
  opportunity_assessment text not null,
  recommended_actions jsonb not null default '[]'::jsonb,
  affected_clients jsonb not null default '[]'::jsonb,
  impact_level text not null
    check (impact_level in ('critical', 'high', 'medium', 'low', 'informational')),
  confidence_score numeric(4, 3) not null check (confidence_score between 0 and 1),
  confidence_rationale text not null,
  source_classification text not null
    check (source_classification in ('verified_announcement', 'official_documentation', 'commentary', 'speculation', 'prediction', 'unknown')),
  summary text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  requested_by uuid references public.profiles (id) on delete set null,
  is_current boolean not null default true,
  analyzed_at timestamptz not null default now()
);
create index ai_analyses_intelligence_idx on public.ai_analyses (intelligence_id, analyzed_at desc);
create unique index ai_analyses_current_key on public.ai_analyses (intelligence_id) where is_current;

create table public.client_impacts (
  id uuid primary key default gen_random_uuid(),
  intelligence_id uuid not null references public.intelligence_items (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  impact_reason text not null,
  recommended_action text,
  review_status text not null default 'suggested'
    check (review_status in ('suggested', 'confirmed', 'in_review', 'not_affected', 'resolved')),
  origin text not null default 'manual' check (origin in ('manual', 'ai', 'rule')),
  owner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (intelligence_id, client_id)
);
create index client_impacts_client_idx on public.client_impacts (client_id);
create trigger client_impacts_updated_at before update on public.client_impacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Action Center
-- ---------------------------------------------------------------------------
create table public.actions (
  id uuid primary key default gen_random_uuid(),
  intelligence_id uuid references public.intelligence_items (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  cloudflare_finding_id uuid,  -- FK added in cloudflare migration
  title text not null check (length(trim(title)) > 0),
  description text,
  department text,
  assigned_to uuid references public.profiles (id) on delete set null,
  priority text not null default 'medium' check (priority in ('critical', 'high', 'medium', 'low')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'in_review', 'completed', 'dismissed')),
  due_date date,
  completed_at timestamptz,
  external_ref text,  -- reserved for future ClickUp linkage (never auto-created)
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index actions_status_idx on public.actions (status);
create index actions_assigned_idx on public.actions (assigned_to);
create index actions_intelligence_idx on public.actions (intelligence_id);
create index actions_client_idx on public.actions (client_id);
create trigger actions_updated_at before update on public.actions
  for each row execute function public.set_updated_at();

create or replace function public.actions_set_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and (old is null or old.status <> 'completed') then
    new.completed_at = now();
  elsif new.status <> 'completed' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;
create trigger actions_completed_at before insert or update on public.actions
  for each row execute function public.actions_set_completed_at();

create table public.action_comments (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.actions (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index action_comments_action_idx on public.action_comments (action_id, created_at);

-- ---------------------------------------------------------------------------
-- Per-user state
-- ---------------------------------------------------------------------------
create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  intelligence_id uuid not null references public.intelligence_items (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, intelligence_id)
);

create table public.read_receipts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  intelligence_id uuid not null references public.intelligence_items (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, intelligence_id)
);

create table public.intelligence_notes (
  id uuid primary key default gen_random_uuid(),
  intelligence_id uuid not null references public.intelligence_items (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index intelligence_notes_item_idx on public.intelligence_notes (intelligence_id, created_at);

-- ---------------------------------------------------------------------------
-- Logs
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_created_idx on public.activity_logs (created_at desc);
create index activity_logs_user_action_idx on public.activity_logs (user_id, action, created_at desc);

create table public.ingestion_logs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources (id) on delete cascade,
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  trigger text not null default 'scheduled' check (trigger in ('scheduled', 'manual')),
  records_found integer not null default 0,
  records_created integer not null default 0,
  records_duplicate integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index ingestion_logs_source_idx on public.ingestion_logs (source_id, started_at desc);
