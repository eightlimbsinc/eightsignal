-- Row Level Security. Every table is private: anonymous users get nothing,
-- 'pending' users get nothing, viewers read, analysts/admins write.

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'allowed_email_domains', 'clients', 'sources', 'intelligence_items',
    'ai_analyses', 'client_impacts', 'actions', 'action_comments', 'bookmarks',
    'read_receipts', 'intelligence_notes', 'activity_logs', 'ingestion_logs',
    'cloudflare_accounts', 'cloudflare_credentials', 'cloudflare_zones', 'monitored_urls',
    'cloudflare_audits', 'cloudflare_config_snapshots', 'cloudflare_config_changes',
    'cloudflare_findings', 'cloudflare_access_tests', 'cloudflare_crawler_policies',
    'cloudflare_incidents'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- Standard internal tables: members read, editors write, admins delete.
do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'sources', 'intelligence_items', 'ai_analyses', 'client_impacts', 'actions',
    'cloudflare_accounts', 'cloudflare_zones', 'monitored_urls', 'cloudflare_audits',
    'cloudflare_config_snapshots', 'cloudflare_config_changes', 'cloudflare_findings',
    'cloudflare_access_tests', 'cloudflare_crawler_policies'
  ]
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_editor())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_editor()) with check (public.is_editor())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_delete', t);
  end loop;
end;
$$;

-- Profiles: members can see teammates (for assignment); users can see themselves even while pending.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_member());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Access allowlist: admins only.
create policy allowed_domains_admin on public.allowed_email_domains for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Comments and notes: members read; editors write as themselves; authors or admins delete.
create policy action_comments_select on public.action_comments for select to authenticated
  using (public.is_member());
create policy action_comments_insert on public.action_comments for insert to authenticated
  with check (public.is_editor() and author_id = auth.uid());
create policy action_comments_delete on public.action_comments for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

create policy intelligence_notes_select on public.intelligence_notes for select to authenticated
  using (public.is_member());
create policy intelligence_notes_insert on public.intelligence_notes for insert to authenticated
  with check (public.is_member() and author_id = auth.uid());
create policy intelligence_notes_delete on public.intelligence_notes for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- Per-user state: own rows only.
create policy bookmarks_own on public.bookmarks for all to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());
create policy read_receipts_own on public.read_receipts for all to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- Activity log: append-only for members (as themselves); readable by admins.
create policy activity_logs_insert on public.activity_logs for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());
create policy activity_logs_select on public.activity_logs for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

-- Ingestion logs: written by the service role (scheduled jobs) and editors (manual runs).
create policy ingestion_logs_select on public.ingestion_logs for select to authenticated
  using (public.is_member());
create policy ingestion_logs_insert on public.ingestion_logs for insert to authenticated
  with check (public.is_editor());
create policy ingestion_logs_update on public.ingestion_logs for update to authenticated
  using (public.is_editor()) with check (public.is_editor());

-- Security incident history: restricted to analysts and admins.
create policy cloudflare_incidents_select on public.cloudflare_incidents for select to authenticated
  using (public.is_editor());
create policy cloudflare_incidents_insert on public.cloudflare_incidents for insert to authenticated
  with check (public.is_editor());
create policy cloudflare_incidents_update on public.cloudflare_incidents for update to authenticated
  using (public.is_editor()) with check (public.is_editor());
create policy cloudflare_incidents_delete on public.cloudflare_incidents for delete to authenticated
  using (public.is_admin());

-- cloudflare_credentials: RLS enabled and forced with NO policies => only the
-- service role (which bypasses RLS) can read or write it.
revoke all on public.cloudflare_credentials from authenticated;

-- Activity logs and snapshots are immutable audit records.
revoke update, delete on public.activity_logs from authenticated;
revoke update, delete on public.cloudflare_config_snapshots from authenticated;

grant usage on schema public to authenticated;
grant execute on function public.is_member(), public.is_editor(), public.is_admin(), public.current_role_name() to authenticated;
revoke execute on function public.is_member(), public.is_editor(), public.is_admin(), public.current_role_name() from public, anon;
grant execute on function public.is_member(), public.is_editor(), public.is_admin(), public.current_role_name() to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
