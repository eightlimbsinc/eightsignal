# EightSignal

**Know what changes. Understand what matters. Act before it becomes a problem.**

EightSignal is 8limbs Inc.'s internal intelligence-to-action platform. It collects
developments from AI platforms and infrastructure providers, analyses their impact
with Claude, maps them to affected clients, and turns them into tasks. Its priority
module monitors **Cloudflare security and AI-crawler/agent accessibility for Blend360**
in **read-only, advisory mode**.

| | |
|---|---|
| Framework | Next.js 16 (App Router, React 19, TypeScript, Turbopack) |
| UI | Tailwind CSS v4, shadcn/ui-style components (Radix), Recharts, Lucide |
| Data/Auth | Supabase PostgreSQL + Supabase Auth + Row Level Security |
| AI | Anthropic Claude API (server-side, structured outputs) |
| Hosting | Netlify (OpenNext adapter `@netlify/plugin-nextjs` v5) + Netlify Scheduled Functions |

---

## Modules

| Module | Route | What it does |
|---|---|---|
| Overview | `/` | KPIs, **Signals That Matter** (ranked by impact × exposure × recency), **Needs Attention** (Blend360 Cloudflare findings first), provider/category charts |
| Intelligence | `/intelligence` | Feed with search, provider/category/impact/status/date filters, bookmarks, read/unread, notes, URL submission + manual entry, duplicate detection |
| Impact Analysis | `/analysis` | Claude analyses across records, department view, client-impact suggestions to confirm/reject |
| Cloudflare Monitor | `/cloudflare` | Security & AI Readiness status per zone, AI crawler/agent access matrix, findings, change history, setup, incident log |
| Action Center | `/actions` | Tasks from recommendations/findings; assignment, due dates, priorities, statuses, comments |
| Clients | `/clients` | Client registry with manually recorded tech stacks; per-client impacts, zones and tasks |
| Sources | `/sources` | RSS/Atom/changelog/announcement sources, manual runs, collection history, reprocessing |
| Settings | `/settings` | Roles, auto-approved domains, configuration status, activity log |

### Cloudflare Monitor (priority)

For each registered zone a **full audit** runs these checks and records the status of
each one (`completed`, `unavailable`, `failed`, `skipped`, `manual_verification`):

| Check | Source | Notes |
|---|---|---|
| API connection | `GET /user/tokens/verify` (falls back to account token verify) | Scoped token only |
| WAF custom rules | `GET /zones/{id}/rulesets/phases/http_request_firewall_custom/entrypoint` | Heuristic review: crawler/agent UA matches, generic `bot` matches, verified-bot targeting, site-wide challenges, robots/sitemap paths, rule ordering vs. verified-bot skip |
| Redirect rules | `…/phases/http_request_dynamic_redirect/entrypoint` + `GET /zones/{id}/pagerules` | Loops, chains, bot-conditional redirects, verification/login targets, external destinations, open-redirect risk, important pages |
| Bot settings | `GET /zones/{id}/bot_management` | Captures AI-bot blocking where the plan exposes it |
| Security events | GraphQL Analytics `firewallEventsAdaptive` (24h) | Mitigations for requests *claiming* each crawler identity; last observed activity |
| Account audit log | `GET /accounts/{id}/audit_logs` | Configuration change history |
| AI Crawl Control per-crawler policy | — | **Manual verification**: recorded by an analyst in the AI access matrix |
| robots.txt | HTTPS fetch | RFC 9309 parser; per-identity directives, wildcard rules, sitemaps, Cloudflare-managed section, Content-Signal |
| Accessibility tests | HTTPS requests with configured UAs | Baseline browser vs. each crawler UA; status, timing, final URL, redirect chain, sanitized headers, challenge detection |

Every configuration read is stored as a **snapshot** (canonical JSON + SHA-256). When a
hash changes, a **change record** is created with previous/current configuration, a
structured diff, detection source, potential impact and recommended action. Medium+
changes also raise findings. Differences are never presumed malicious.

**Status** is `Healthy` only when every required check (API, WAF, redirects, robots.txt,
access tests) completed in the last 7 days with no open findings above *low*. A working
API connection alone never yields Healthy.

The four identity classes — **search crawlers, user-directed fetchers, browser/personal
agents, training crawlers** — are always evaluated separately. robots.txt (advisory) and
Cloudflare enforcement are displayed side by side and never conflated. Simulated
user-agent tests are labelled as such: they do **not** prove how authentic, verified
crawler traffic is treated.

---

## Local development

Requirements: Node.js 22+, a Supabase project (or the Supabase CLI), an Anthropic API key.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `.env.local` (see [Environment variables](#environment-variables)), apply the
migrations (next section), then:

```bash
npm run dev
```

### Database migrations

Migrations live in `supabase/migrations/` and are applied in filename order:

1. `…_core_schema.sql` – profiles/roles, clients, sources, intelligence, analyses, impacts, actions, logs
2. `…_cloudflare_schema.sql` – accounts, credentials, zones, monitored URLs, audits, snapshots, changes, findings, access tests, crawler policies, incidents
3. `…_rls_policies.sql` – Row Level Security for every table

With the Supabase CLI:

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push
```

Or paste each file into the Supabase SQL editor in order. Optionally run
`supabase/seed.sql` to add the Blend360 client/zone and **inactive** starter sources
(verify each source URL before activating it). The seed contains no intelligence records.

### First admin

1. In Supabase → Authentication → Providers, keep Email enabled and **disable public sign-ups**.
2. Invite yourself (Authentication → Users → Invite user). New users start as `pending`.
3. In the SQL editor, promote yourself:

```sql
update public.profiles set role = 'admin' where email = 'you@yourcompany.com';
```

4. Optionally add your company domain under **Settings → Auto-approved email domains** so
   future invitees get `viewer`/`analyst` automatically.
5. Set Supabase Auth's Site URL / redirect URLs to include `https://<your-site>/auth/callback`.

Roles: `admin` (everything, incl. Cloudflare tokens and roles) · `analyst` (create/edit,
run audits and analyses, incident log) · `viewer` (read-only) · `pending` (no access).

### Tests

```bash
npm test
```

Unit tests (Vitest) for SSRF protection, URL canonicalisation and fingerprints, HTML/feed
extraction, robots.txt semantics, WAF and redirect audits, snapshot diffs, health scoring,
access classification, token encryption, AI output validation and prompt isolation.

```bash
npm run test:db
```

Applies all migrations to a throwaway local PostgreSQL (with a stub of Supabase's `auth`
schema), as a non-superuser owner, and runs RLS assertions (pending users see nothing,
analysts cannot read credentials or delete, anonymous access is denied, duplicate
fingerprints are rejected). Requires local PostgreSQL binaries.

```bash
npm run lint
```

```bash
npm run typecheck
```

---

## Environment variables

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Supabase anon key (RLS-restricted) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Scheduled jobs, audits, credential storage |
| `ANTHROPIC_API_KEY` | **server only** | Claude impact analysis |
| `ANTHROPIC_MODEL` | server | Default `claude-opus-5-5` |
| `ANTHROPIC_EFFORT` | server | `low` / `medium` (default) / `high` |
| `AI_ANALYSES_PER_USER_PER_HOUR` | server | Per-user AI rate limit (default 30) |
| `AUTO_ANALYZE_INGESTED` | server | Analyse ingested records on schedule (default `true`) |
| `NEXT_PUBLIC_APP_URL` | public | Base URL for auth email links |
| `CRON_SECRET` | **server only** | Bearer secret for `/api/cron/*` (`openssl rand -hex 32`) |
| `CLOUDFLARE_CREDENTIALS_KEY` | **server only** | 32-byte key (base64/hex) for AES-256-GCM token encryption (`openssl rand -base64 32`) |
| `CLOUDFLARE_TOKEN_<NAME>` | **server only** | Optional: tokens referenced by name instead of stored in the DB |

Never commit real values. `.env*` is git-ignored except `.env.example`.

### Cloudflare API token

Create a **custom API token** (never a Global API Key — it is rejected) restricted to the
client's zone(s) with **Read** permissions only: Zone, Zone WAF, Dynamic/Single Redirect,
Page Rules (optional), Bot Management (plan-dependent), Analytics (optional), and
Account audit logs (optional). Any missing permission makes that check `unavailable`
instead of failing the audit. Add it in **Cloudflare Monitor → Connect / register**
(admins only) either encrypted in the database or as a reference to a
`CLOUDFLARE_TOKEN_*` environment variable.

---

## Deployment (Netlify)

1. Create a Netlify site from this repository. `netlify.toml` sets the build
   (`npm run build`, Node 22) and pins `@netlify/plugin-nextjs` (OpenNext adapter v5,
   which supports Next.js 16 including the Node.js `proxy`).
2. Add all environment variables under Site configuration → Environment variables
   (mark secrets as secret; scope server-only values to Functions/Runtime).
3. Deploy. Scheduled functions in `netlify/functions/` are picked up automatically:

| Function | Schedule | Calls |
|---|---|---|
| `scheduled-ingest` | hourly | `POST /api/cron/ingest` – collects due sources (per-source interval, failure back-off) |
| `scheduled-analyze` | every 5 min | `POST /api/cron/analyze` – analyses the newest pending ingested record (last 30 days by default) |
| `scheduled-cloudflare-audit` | hourly | `POST /api/cron/cloudflare` – audits the most overdue zone if >6h since last audit |

Each scheduled function only calls a protected route on the same site with
`Authorization: Bearer $CRON_SECRET`; all logic lives in the app and nothing depends on
persistent background processes. Make.com can call the same endpoints instead.

### Netlify limits to be aware of

- **Function duration.** Synchronous Netlify Functions have a limited execution time
  (scheduled functions ~30s). Claude analyses commonly take 10–40s depending on content
  and effort. Cron jobs process one item per call and record `running/failed` state so a
  timeout is recoverable; the UI's "Analyse" button runs within a single request. If
  analyses time out, lower `ANTHROPIC_EFFORT`, or ask Netlify to raise the function
  timeout for the site.
- **Outbound IPs.** Accessibility tests originate from Netlify's network. Cloudflare may
  score those requests differently from residential visitors; results are labelled as
  simulated server-side tests.

---

## Security model

- All secrets are server-side; nothing sensitive is exposed via `NEXT_PUBLIC_*`.
- Every route except `/login`, `/auth/*` and `/api/cron/*` requires a session (`src/proxy.ts`);
  pages additionally require an approved role, and every mutation re-checks the role server-side.
- RLS on every table; `cloudflare_credentials` has **no** policies (service role only) and
  tokens are AES-256-GCM encrypted. Token values are never returned to the browser.
- Outbound fetching (`src/lib/security/safe-fetch.ts`): http/https only, ports 80/443,
  no credentials in URLs, private/reserved/link-local/metadata addresses blocked **at DNS
  resolution time** (defeats DNS rebinding), every redirect hop re-validated, timeouts,
  response size caps, decompression handled safely.
- External content is stored as plain text, rendered escaped (no `dangerouslySetInnerHTML`),
  and passed to Claude inside an `<untrusted_source_content>` block with explicit
  instructions not to follow embedded instructions. AI output is schema-validated;
  client names the model invents are discarded.
- AI usage is rate-limited per user (DB-backed). Administrative actions are written to
  `activity_logs`.
- Cloudflare: GET-only REST client plus the read-only GraphQL Analytics endpoint. There
  is no code path that writes Cloudflare configuration. Any future write capability must
  require explicit human approval and audit logging (see ADR 0003).
- No ClickUp tasks or Slack messages are ever sent automatically.

---

## Project structure

```
src/
  app/(app)/…        authenticated pages + server actions per module
  app/api/cron/…     scheduled entry points (CRON_SECRET)
  app/login, auth/   sign-in, callback, sign-out
  components/        ui/ (shadcn-style), shared/, layout/, charts/
  lib/
    ai/              prompt, schema, Claude client, analysis runner, rate limit
    cloudflare/      read-only API client, crawler registry, audits, snapshots, health, runner
    intel/           taxonomy & provider registry, normalisation, extraction, scoring, service
    ingestion/       feed adapter, source collectors, ingestion runner
    security/        SSRF-safe fetch, IP validation
    supabase/        server/browser/admin clients, session proxy
supabase/migrations  version-controlled SQL
supabase/tests       auth stub + RLS assertions
netlify/functions    scheduled functions
docs/adr             architecture decision records
tests/               Vitest unit tests
```

Adding a provider: add an entry to `PROVIDERS` in `src/lib/intel/taxonomy.ts`, then add its
official sources in **Sources**. No schema change is needed.

## Developer guide

See [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) for architecture, local setup, schema changes, operations runbook and how to extend the platform.

## Known limitations

See [docs/STATUS.md](docs/STATUS.md).
