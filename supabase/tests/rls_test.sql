-- RLS behaviour tests. Run via scripts/test-migrations.sh. Any failed assertion raises.
insert into public.allowed_email_domains (domain, default_role) values ('example.test', 'analyst');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'analyst@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'stranger@elsewhere.test');
update public.profiles set role = 'admin' where email = 'admin@example.test';

do $$ begin
  assert (select role from public.profiles where email = 'analyst@example.test') = 'analyst', 'allowlisted domain should get analyst';
  assert (select role from public.profiles where email = 'stranger@elsewhere.test') = 'pending', 'unknown domain should be pending';
end $$;

insert into public.clients (id, name, cdn_provider) values ('10000000-0000-0000-0000-000000000001', 'Blend360', 'Cloudflare');
insert into public.cloudflare_accounts (id, client_id, account_name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Blend360');
insert into public.cloudflare_credentials (cloudflare_account_id, storage, encrypted_token, token_hint)
  values ('20000000-0000-0000-0000-000000000001', 'encrypted', 'ciphertext', 'abcd');
insert into public.cloudflare_incidents (client_id, title, description, severity, incident_date)
  values ('10000000-0000-0000-0000-000000000001', 'Test incident', 'desc', 'high', current_date);

-- Pending user sees nothing.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  assert (select count(*) from public.clients) = 0, 'pending user must not read clients';
  assert (select count(*) from public.profiles) = 1, 'pending user sees only own profile';
end $$;
do $$ begin
  begin
    insert into public.clients (name) values ('x');
    raise exception 'pending user inserted a client';
  exception when insufficient_privilege then null; end;
end $$;
-- Pending user cannot self-promote.
do $$ begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'self promotion succeeded';
  exception when raise_exception then
    if sqlerrm = 'self promotion succeeded' then raise; end if;
  end;
end $$;

-- Analyst: reads and writes, but cannot read credentials or delete.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.clients) = 1, 'analyst reads clients';
  assert (select count(*) from public.cloudflare_incidents) = 1, 'analyst reads incidents';
end $$;
do $$ begin
  begin
    perform * from public.cloudflare_credentials;
    raise exception 'analyst read credentials';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.intelligence_items (title, slug, provider, category, content_fingerprint)
  values ('Test', 'test', 'cloudflare', 'security', 'fp1');
delete from public.clients;  -- silently filtered by RLS
do $$ begin
  assert (select count(*) from public.clients) = 1, 'analyst must not delete clients';
end $$;
-- Duplicate fingerprint is rejected.
do $$ begin
  begin
    insert into public.intelligence_items (title, slug, provider, category, content_fingerprint)
      values ('Test 2', 'test-2', 'cloudflare', 'security', 'fp1');
    raise exception 'duplicate fingerprint accepted';
  exception when unique_violation then null; end;
end $$;

-- Client deletion: analysts cannot; admins can, and it cascades (tasks are kept, unlinked).
reset role;
insert into public.cloudflare_zones (id, client_id, domain) values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'blend360.com');
insert into public.cloudflare_findings (zone_id, finding_key, finding_type, severity, title, description)
  values ('30000000-0000-0000-0000-000000000001', 'k', 't', 'high', 'x', 'y');
insert into public.actions (id, client_id, title) values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Task');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
delete from public.clients where id = '10000000-0000-0000-0000-000000000001';
reset role;
do $$ begin
  assert (select count(*) from public.clients) = 0, 'admin delete failed';
  assert (select count(*) from public.cloudflare_zones) = 0, 'zones not cascaded';
  assert (select count(*) from public.cloudflare_findings) = 0, 'findings not cascaded';
  assert (select count(*) from public.cloudflare_credentials) = 0, 'credentials not cascaded';
  assert (select count(*) from public.cloudflare_incidents) = 0, 'incidents not cascaded';
  assert (select client_id from public.actions where id = '40000000-0000-0000-0000-000000000001') is null, 'task should be kept and unlinked';
end $$;

-- Anonymous: nothing.
reset request.jwt.claim.sub;
set role anon;
do $$ begin
  begin
    perform * from public.intelligence_items;
    raise exception 'anon read intelligence';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'RLS tests passed' as result;
