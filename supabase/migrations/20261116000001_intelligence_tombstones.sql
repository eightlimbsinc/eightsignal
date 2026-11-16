-- Remember deleted intelligence so automatic collection does not re-import it.
-- Manual entry / URL submission may still re-add a deleted article on purpose.

create table public.intelligence_tombstones (
  id uuid primary key default gen_random_uuid(),
  canonical_url text,
  content_fingerprint text,
  title text,
  provider text,
  source_id uuid references public.sources (id) on delete set null,
  reason text not null default 'deleted'
    check (reason in ('deleted', 'bulk_unassessed', 'source_deleted')),
  deleted_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz not null default now(),
  check (canonical_url is not null or content_fingerprint is not null)
);
create index intelligence_tombstones_url_idx on public.intelligence_tombstones (canonical_url) where canonical_url is not null;
create index intelligence_tombstones_fp_idx on public.intelligence_tombstones (content_fingerprint) where content_fingerprint is not null;

alter table public.intelligence_tombstones enable row level security;
revoke all on public.intelligence_tombstones from anon;

-- Members can read (ingestion run by an analyst checks it); only admins create; immutable.
create policy intelligence_tombstones_select on public.intelligence_tombstones for select to authenticated
  using (public.is_member());
create policy intelligence_tombstones_insert on public.intelligence_tombstones for insert to authenticated
  with check (public.is_admin());
revoke update, delete on public.intelligence_tombstones from authenticated;
