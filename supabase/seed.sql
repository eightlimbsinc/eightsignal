-- Optional starter data. Contains NO intelligence records: intelligence only ever
-- comes from real sources or manual entry.
--
-- Sources are inserted INACTIVE. Verify each URL resolves to an official feed or
-- page from your network before activating it in Sources.

insert into public.sources (name, provider, source_url, source_type, default_category, config, notes) values
  ('OpenAI News (RSS)', 'openai', 'https://openai.com/news/rss.xml', 'rss', 'product', '{}',
   'Verify feed URL before activating.'),
  ('Cloudflare Blog (RSS)', 'cloudflare', 'https://blog.cloudflare.com/rss/', 'rss', 'product', '{}',
   'Verify feed URL before activating.'),
  ('Cloudflare Changelog', 'cloudflare', 'https://developers.cloudflare.com/changelog/', 'changelog_page', 'platform_change',
   '{"link_pattern": "^/changelog/[^/]+"}', 'Changelog listing page; links are extracted, dates only when present.'),
  ('Anthropic News', 'anthropic', 'https://www.anthropic.com/news', 'announcement_page', 'product',
   '{"link_pattern": "^/news/[^/]+"}', 'Announcement listing page; verify link pattern before activating.'),
  ('Claude Code releases (GitHub Atom)', 'anthropic', 'https://github.com/anthropics/claude-code/releases.atom', 'atom', 'developer_tools', '{}',
   'GitHub release feed. Verify before activating.')
on conflict (source_url) do nothing;

-- Primary client: Blend360 (Cloudflare-protected). Confirm the domain before enabling monitoring.
insert into public.clients (name, website_url, industry, cdn_provider, technology_stack, active_services, notes)
values ('Blend360', 'https://www.blend360.com', 'Data science & marketing services', 'Cloudflare',
        array['Cloudflare'], array['Website management', 'Technical SEO', 'Security monitoring'],
        'Primary Cloudflare Security & AI Readiness monitoring client.')
on conflict do nothing;

insert into public.cloudflare_zones (client_id, domain, monitoring_enabled)
select id, 'blend360.com', true from public.clients where lower(name) = 'blend360'
on conflict (domain) do nothing;

insert into public.monitored_urls (zone_id, url, label, page_type, is_critical)
select z.id, v.url, v.label, v.page_type, v.is_critical
from public.cloudflare_zones z
cross join (values
  ('https://www.blend360.com/', 'Homepage', 'homepage', true),
  ('https://www.blend360.com/robots.txt', 'robots.txt', 'robots', true),
  ('https://www.blend360.com/sitemap.xml', 'Sitemap', 'sitemap', true)
) as v(url, label, page_type, is_critical)
where z.domain = 'blend360.com'
on conflict (zone_id, url) do nothing;
