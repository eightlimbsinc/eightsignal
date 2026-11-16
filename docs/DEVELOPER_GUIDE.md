# EightSignal — Developer Guide

For developers maintaining or extending EightSignal. Read this first, then the
[README](../README.md) (product overview, env vars, deployment) and the
[architecture decision records](adr/). Current status and known limitations are in
[STATUS.md](STATUS.md).

> **Never commit secrets.** All keys live in a password manager, Netlify environment
> variables, and your local `.env.local` (git-ignored).

---

## 1. What you are working on

EightSignal is 8limbs' internal intelligence-to-action platform:

1. **Intelligence**: collects announcements from AI and infrastructure providers (RSS/Atom/changelog pages, manual URL submission, manual entry), deduplicates them, and stores the original sources.
2. **AI impact analysis**: Claude produces a structured assessment per record (what happened, why it matters, risks, opportunities, affected clients, recommended actions, impact, confidence).
3. **Action Center**: turns recommendations and findings into tasks.
4. **Cloudflare Monitor** (priority, for Blend360): **read-only** audits of WAF rules, redirects, bot settings, security events, robots.txt and simulated crawler access, with snapshots, change history, findings and a health status.

### Production setup

| Piece | Where |
|---|---|
| Code | GitHub `eightlimbsinc/eightsignal`, branch **`claude/magical-ride-fvcqj6`** (currently the deployed branch; see §10) |
| Hosting | Netlify site **eightsignal.netlify.app**; auto-deploys on every push to the deployed branch |
| Database + Auth | Supabase project (PostgreSQL + Supabase Auth + RLS) |
| AI | Anthropic Claude API, model `claude-opus-5-5` by default |
| Scheduled jobs | Netlify Scheduled Functions in `netlify/functions/` |

Ask an EightSignal admin for: GitHub access, Netlify team access, Supabase project
access, and a **separate development Supabase project** (see §3).

---

## 2. Stack and version notes

- **Next.js 16** (App Router, Turbopack, React 19). This is **not** the Next.js most tutorials describe:
  - `middleware.ts` is replaced by **`src/proxy.ts`** (Node runtime).
  - `params`, `searchParams`, `cookies()` and `headers()` are **async**; use the generated `PageProps<"/route">` types (`npx next typegen`).
  - Bundled docs for the installed version live in `node_modules/next/dist/docs/`; check them before using an API. `AGENTS.md` says the same thing for AI coding assistants.
  - Cache Components / PPR are **off** on purpose: every page is per-user and RLS-filtered (ADR 0001).
- **Tailwind CSS v4** with design tokens in `src/app/globals.css` (dark theme, shadcn-compatible variable names).
- **UI components**: shadcn/ui-style, hand-written in `src/components/ui/` (Radix via the `radix-ui` package). `components.json` is present, so the shadcn CLI can add more later.
- **Supabase**: `@supabase/ssr` for cookie sessions, `@supabase/supabase-js` for the service-role client.
- **Anthropic SDK** `@anthropic-ai/sdk` 1.x: `client.beta.messages.parse` with Zod structured outputs.
- **Zod 4** for all input validation. **Vitest** for tests.
- **Node 22** (pinned in `netlify.toml`).

---

## 3. Local development

### 3.1 Prerequisites
- Node.js 22+, npm
- A **development** Supabase project. Never develop against production: the service-role key bypasses all security.
- Optional: local PostgreSQL 14+ binaries for `npm run test:db`.

### 3.2 First run
```bash
git clone https://github.com/eightlimbsinc/eightsignal.git
```
```bash
cd eightsignal && npm install
```
```bash
cp .env.example .env.local
```
Fill `.env.local` with the **dev** project's values (see README → Environment variables).
Generate local secrets:
```bash
openssl rand -hex 32
```
for `CRON_SECRET`, and
```bash
openssl rand -base64 32
```
for `CLOUDFLARE_CREDENTIALS_KEY`.

### 3.3 Dev database
In the dev Supabase project's **SQL Editor**, run in order:
1. `supabase/migrations/20261112000001_core_schema.sql`
2. `supabase/migrations/20261112000002_cloudflare_schema.sql`
3. `supabase/migrations/20261112000003_rls_policies.sql`
4. `supabase/migrations/20261116000001_intelligence_tombstones.sql`
5. optional: `supabase/seed.sql` (Blend360 client/zone and inactive starter sources)

If the editor asks "Run without RLS / Run and enable RLS", choose **Run and enable RLS**; the third file enables RLS on everything anyway.

Then create your dev user (Authentication → Users → Add user → Create new user, tick **Auto Confirm**) and promote it:
```sql
update public.profiles set role = 'admin' where email = 'you@8limbsinc.net';
```

### 3.4 Run
```bash
npm run dev
```
Open http://localhost:3000 and sign in with the **Password** tab.

---

## 4. Codebase map

```
src/
  proxy.ts                      Session refresh + redirect anonymous users to /login
  app/
    layout.tsx, globals.css     Root layout, design tokens
    global-error.tsx            Last-resort error page (shows digest to match server logs)
    login/, pending/, auth/     Sign-in (password + invite-only magic link), approval gate,
                                auth callback (code / token_hash), sign-out
    (app)/                      Everything behind auth; layout.tsx = sidebar shell + role gate
      page.tsx                  Overview (Signals That Matter, Needs Attention, charts)
      intelligence/             Feed, detail, new (URL + manual) + actions.ts
      analysis/                 Impact Analysis overview
      cloudflare/               Dashboard, zones/[id], setup, incidents + actions.ts
      actions/                  Action Center (tasks) + actions.ts
      clients/                  Client registry, detail, delete + actions.ts
      sources/                  Ingestion sources, history, reprocessing + actions.ts
      settings/                 Profile/password, roles, auto-approved domains, activity log
    api/cron/{ingest,analyze,cloudflare}/route.ts   Scheduled entry points (CRON_SECRET)
  components/
    ui/                         Button, Card, Badge, Input/Select/Textarea, Table
    shared/                     Page header, stat cards, badges, ActionForm/SubmitButton
    layout/sidebar.tsx          Collapsible sidebar + mobile drawer
    charts/bar-list.tsx         Recharts single-series bar chart
  lib/
    env.ts                      Validated server env access (server-only)
    auth.ts                     getSession / requireMember / requireEditor / requireAdmin
    activity.ts                 Append-only activity log helper
    supabase/                   server (user session), browser, admin (service role), proxy
    security/                   ip.ts (URL/IP validation), safe-fetch.ts (SSRF-safe HTTP)
    intel/                      taxonomy (providers/categories), normalize (canonical URL,
                                fingerprint), html (extraction), scoring, service (create + dedupe)
    ai/                         prompt, schema (Zod + validation), analyze (Claude call), run
                                (store analysis, client impacts, rate limit)
    ingestion/                  adapters/feed.ts (RSS/Atom), run.ts (collect, dedupe, log)
    cloudflare/                 api (read-only client), crawlers (identity registry),
                                waf-audit, redirect-audit, robots, access, snapshot, health,
                                credentials (AES-GCM), token, runner (orchestrates a full audit)
supabase/
  migrations/                   Version-controlled SQL (schema, Cloudflare, RLS)
  seed.sql                      Optional starter data (no intelligence records)
  tests/                        auth_stub.sql + rls_test.sql for scripts/test-migrations.sh
netlify/functions/              scheduled-ingest, scheduled-analyze, scheduled-cloudflare-audit
tests/                          Vitest unit tests
docs/                           This guide, STATUS.md, ADRs
```

**Rule of thumb:** business logic lives in `src/lib/**` (pure and testable where possible);
pages render; `actions.ts` files validate input, check the role, call `lib`, log activity and
revalidate.

---

## 5. How things work

### 5.1 Auth and authorization (three layers)
1. **`src/proxy.ts`** refreshes the Supabase session cookie on every request and redirects anonymous users to `/login`. Public paths: `/login`, `/auth/*`, `/api/cron/*`.
2. **Pages** call `requireMember()`: anonymous users go to `/login`, `pending` users to `/pending`.
3. **Mutations** (server actions) call `requireEditor()` or `requireAdmin()` and are also enforced by **RLS** in Postgres.

Roles (`profiles.role`): `admin` · `analyst` · `viewer` · `pending`. New users get a role from
`allowed_email_domains` (Settings → Auto-approved email domains), otherwise `pending`.
RLS helpers: `is_member()`, `is_editor()`, `is_admin()` (SECURITY DEFINER SQL functions).

**Service-role client (`createAdminClient`) bypasses RLS.** Only use it in server code
**after** an explicit role check, or with the cron secret. Current uses: Cloudflare audits and
credential storage, cron routes, and token hints on the setup page (admins only).

### 5.2 Server action pattern
```ts
"use server";
export async function doThing(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { db, user } = await requireEditor();          // 1. authorize
    const input = Schema.parse(Object.fromEntries(formData)); // 2. validate (Zod)
    const { error } = await db.from("table").insert(...);  // 3. act (RLS applies)
    if (error) return { error: error.message };
    await logActivity(db, { userId: user.id, action: "thing.create", entityType: "thing" }); // 4. audit
    revalidatePath("/things");                              // 5. refresh
    return { ok: true, message: "Done." };
  } catch (e) { return fail(e); }
}
```
Client side: wrap forms in `ActionForm` or use `useActionState` + `SubmitButton` + `FormMessage`
from `src/components/shared/form.tsx` (gives pending, success and error states).

### 5.3 Intelligence pipeline
`createIntelligence()` (`lib/intel/service.ts`) is the single entry point for manual entry,
URL submission and ingestion:
1. `canonicalizeUrl()`: lower-case host, strip tracking params and fragments, sort query, force https.
2. `contentFingerprint()`: SHA-256 of normalized title + first 2,000 characters of body.
3. Duplicate check on either; Postgres unique indexes are the final guard (race-safe).
4. Records start with `analysis_status = 'pending'`, `impact_level = 'unassessed'`.

URL submission fetches through `safeFetch()` (see §7) and extracts with `extractPage()`.
Dates that aren't on the page stay `null`. **Never fabricate data.**

### 5.4 AI analysis
- `lib/ai/prompt.ts`: system prompt and user message. External text is wrapped in `<untrusted_source_content>`; attempts to close that tag are neutralized. The client registry (names + recorded stack only) is included so Claude can suggest affected clients.
- `lib/ai/schema.ts`: Zod schema for structured output, plus `validateAnalysis()` for rules the schema can't express (confidence 0–1, non-empty sections, **only known client names**).
- `lib/ai/analyze.ts`: `client.beta.messages.parse` with `betaZodOutputFormat`, `output_config.effort` (env `ANTHROPIC_EFFORT`), and the server-side refusal fallback (`fallbacks: "default"`). Handles `refusal`, `max_tokens` and typed SDK errors.
- `lib/ai/run.ts`: stores a new `ai_analyses` row (older rows become `is_current = false`), updates the record's impact, upserts `client_impacts` (AI + rule-based stack match, `review_status = 'suggested'`), and enforces the **per-user hourly rate limit** (DB-based, `AI_ANALYSES_PER_USER_PER_HOUR`).

### 5.5 Ingestion and scheduling
- `lib/ingestion/run.ts`: `collect()` dispatches by `source_type` (`rss`/`atom` → `parseFeed`, `changelog_page`/`announcement_page` → `extractLinks` with the source's `config.link_pattern`). Includes retries with backoff, an 18-second budget per cron run, a politeness delay, and exponential back-off for failing sources. Every run writes `ingestion_logs`.
- Scheduled functions only call protected routes on the same site with `Authorization: Bearer $CRON_SECRET`:

| Function | Schedule | Route | Does |
|---|---|---|---|
| `scheduled-ingest` | hourly | `/api/cron/ingest` | collect due active sources |
| `scheduled-analyze` | every 5 min | `/api/cron/analyze` | analyse the **newest** pending ingested record from the last `AUTO_ANALYZE_MAX_AGE_DAYS` (30) |
| `scheduled-cloudflare-audit` | hourly | `/api/cron/cloudflare` | audit the most overdue monitored zone if more than 6 hours since its last audit |

Trigger one manually (useful for debugging):
```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://eightsignal.netlify.app/api/cron/ingest
```

### 5.6 Cloudflare Monitor (read-only)
`runZoneAudit()` in `lib/cloudflare/runner.ts` runs these checks and records each one's status
(`completed`, `unavailable`, `failed`, `skipped` or `manual_verification`) in `cloudflare_audits.checks`:

| Check | Source | Analysis module |
|---|---|---|
| API connection | `GET /user/tokens/verify` (falls back to account verify) | n/a |
| WAF custom rules | `GET /zones/{id}/rulesets/phases/http_request_firewall_custom/entrypoint` | `waf-audit.ts` |
| Redirect rules | `…/phases/http_request_dynamic_redirect/entrypoint` + `GET /zones/{id}/pagerules` | `redirect-audit.ts` |
| Bot settings | `GET /zones/{id}/bot_management` | inline |
| Security events (24h) | GraphQL `firewallEventsAdaptive` | inline |
| Account audit log | `GET /accounts/{id}/audit_logs` | inline |
| robots.txt | `safeFetch` | `robots.ts` (RFC 9309) |
| Accessibility tests | `safeFetch` with each crawler's UA | `access.ts` (`classifyAccess`, `assessAccessOutcomes`) |

Key concepts:
- **Read-only by construction.** `CloudflareReadOnlyClient` only has GET methods plus the GraphQL query endpoint. Do not add write methods (ADR 0003).
- **Capabilities.** A 403 means "unavailable: token lacks permission", not an error. A 404 on a phase entrypoint means "no rules configured".
- **Findings.** Each draft finding has a stable `key` (for example `waf:identity:<ruleId>`). Re-detections update the open finding. Open findings whose check **completed** but no longer detects them are auto-resolved, using the key prefixes in `coveredPrefixes`.
- **Snapshots.** Canonical JSON + SHA-256. A hash change creates `cloudflare_config_changes` with a structured diff (`snapshot.ts → diffConfigs`) and a severity from `assessChange()`.
- **Health** (`health.ts → computeHealth`). **Healthy** only if all required checks completed within 7 days and no open finding is above `low`. A connection alone is never Healthy.
- **Crawler registry** (`crawlers.ts`). Four separate classes: search, user-directed, browser agent, training. Some UA strings are product-token approximations (`uaConfidence: "token"`).
- **Calibration.** Tests run from Netlify's data-centre IPs with spoofed UAs. Cloudflare often challenges data-centre traffic and correctly rejects fake crawlers. So a challenged baseline is **Medium** ("verify manually"), a simulated crawler denial is **Low/Info**, and only 5xx is **Critical**. Real crawler blocking is established by the WAF audit and security events, never by simulated tests alone.
- **Tokens.** AES-256-GCM with `CLOUDFLARE_CREDENTIALS_KEY`, in `cloudflare_credentials`, which has RLS enabled and **no policies** (service role only). Or `storage = 'env'` references a `CLOUDFLARE_TOKEN_*` env var by name. Only the last 4 characters are ever shown.

---

## 6. Database

### 6.1 Schema highlights
- UUID primary keys, FKs, `created_at`/`updated_at` triggers, CHECK-constrained enums (text).
- Unique indexes: `intelligence_items(canonical_url)`, `(content_fingerprint)`, `(slug)`, `cloudflare_zones(domain)`, open findings `(zone_id, finding_key)`.
- Deleting a **client** cascades to its Cloudflare accounts, tokens, zones, audits, findings, snapshots, tests, incidents and impact links. Tasks are kept with `client_id = null`.
- `activity_logs` and `cloudflare_config_snapshots` are append-only for app users.
- `intelligence_tombstones` remembers deleted articles (canonical URL + fingerprint). `createIntelligence()` returns `suppressed` for **ingestion** when a tombstone matches, so deleted articles aren't re-collected; manual entry can still re-add them. Written by every delete path (single, source, bulk unassessed).

### 6.2 Changing the schema
1. Create a new file `supabase/migrations/YYYYMMDDHHMMSS_short_name.sql`. **Never edit an applied migration.**
2. New tables: enable RLS and add policies in the same migration (follow the patterns in `…_rls_policies.sql`). Use `is_member()` for reads, `is_editor()` for writes and `is_admin()` for deletes.
3. Test locally:
   ```bash
   npm run test:db
   ```
   This applies all migrations to a throwaway PostgreSQL as a **non-superuser, non-BYPASSRLS owner** (worst case for RLS mistakes) and runs `supabase/tests/rls_test.sql`. Add assertions for new policies there.
4. Update `src/lib/types.ts` (types are hand-maintained; `supabase gen types` can replace them).
5. Apply to **dev**, then to **production** via the Supabase SQL Editor.

**Migration history caveat.** Production migrations were applied by pasting SQL into the
SQL Editor, so Supabase's migration history table is empty. If you adopt `supabase db push` or
the Supabase GitHub integration, first mark the existing three as applied, or they will run
twice and fail:
```bash
npx supabase migration repair --status applied 20261112000001 20261112000002 20261112000003 20261116000001
```
If you enable the GitHub integration later: production branch `main`, automatic branching off
unless you want paid preview databases.

---

## 7. Security rules (please keep them)

- **Secrets:** server-only env vars; never `NEXT_PUBLIC_*` for secrets; never log tokens; never return tokens to the browser.
- **Outbound HTTP for untrusted URLs:** always `safeFetch()` / `safeFetchWithRetry()`. It enforces http/https only, ports 80/443, no credentials in URLs, private, reserved and metadata IPs blocked **at DNS resolution** (defeats rebinding), per-hop redirect validation, timeouts and size caps. Never call `fetch()` on a user-supplied URL.
- **Untrusted content:** store as plain text; render escaped (no `dangerouslySetInnerHTML`); keep it inside `<untrusted_source_content>` in prompts.
- **Cloudflare:** read-only. Never automate WAF, redirect, DNS or bot changes. Any future write feature needs explicit human approval and an audit trail (ADR 0003).
- **External systems:** no automatic ClickUp tasks or Slack messages.
- **Redirects after login:** use `safeNextPath()` (same-origin relative paths only).
- **Cron routes:** `authorizeCron()` uses a constant-time comparison of the bearer secret.
- **Activity log:** call `logActivity()` for every administrative mutation.

---

## 8. Testing and quality gates

Run all of these before pushing:
```bash
npm run lint
```
```bash
npm run typecheck
```
```bash
npm test
```
```bash
npm run build
```
Optional, needs local PostgreSQL:
```bash
npm run test:db
```

| Suite | Covers |
|---|---|
| `tests/ssrf.test.ts` | IP and URL validation, loopback and DNS blocking |
| `tests/normalize.test.ts` | canonical URLs, fingerprints |
| `tests/extract.test.ts` | HTML extraction, link extraction, RSS/Atom, entity-attack refusal |
| `tests/robots.test.ts` | RFC 9309 grouping, longest match, findings |
| `tests/cloudflare-audits.test.ts` | WAF and redirect heuristics |
| `tests/cloudflare-core.test.ts` | snapshot diff, health, access classification and calibration, AES-GCM, read-only client, crawler registry |
| `tests/ai.test.ts` | analysis validation, prompt isolation, client matching, signal scoring, safe redirects |
| `supabase/tests/rls_test.sql` | role gating, credential isolation, duplicate guard, client delete cascade |

External services (Supabase, Anthropic, Cloudflare) are **not** called in tests. The
Cloudflare client takes an injectable `fetch` for mocking.

---

## 9. Deployment and operations

### 9.1 Deploying
- Push to the deployed branch → Netlify builds (`npm run build`, Node 22, `@netlify/plugin-nextjs` pinned) → **Published** in about 3 minutes.
- Changing a **`NEXT_PUBLIC_*`** variable requires a redeploy (values are baked in at build time): **Deploys → Trigger deploy → Deploy site**.
- Scheduled functions only run on the **production** deploy.

### 9.2 Logs
- Netlify → **Logs & metrics → Functions**:
  - **Next.js Server Handler**: page and server-action errors. A user-facing "EightSignal hit a server error" page shows a **Reference** (digest). Search for it here.
  - `scheduled-ingest`, `scheduled-analyze`, `scheduled-cloudflare-audit`: one log line per run with the route's response.
- Supabase → **Logs** (Auth, Postgres) for sign-in and database errors.
- In-app: **Sources → Collection history**; **Settings → Activity log**; each zone's **Last audit** check list.

### 9.3 Runbook

| Task | How |
|---|---|
| Invite a teammate | Supabase → Authentication → Users → **Send invitation** (or **Create new user** + Auto Confirm if email is rate-limited). Role comes from Settings → Auto-approved domains; adjust in Settings → Team & roles. They set a password in Settings → Password. |
| Email links (invite / magic link) | Templates must use `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite` (or `type=email` for magic link). Site URL and Redirect URL (`/auth/callback`) set in Authentication → URL Configuration. |
| "email rate limit exceeded" | Supabase's built-in sender is limited. Configure SMTP (Authentication → Emails → SMTP Settings) and raise Authentication → Rate Limits. |
| Rotate Anthropic key | Create a new key in console.anthropic.com → update `ANTHROPIC_API_KEY` in Netlify → redeploy → revoke the old key. |
| Rotate Cloudflare token | Create the new token → Cloudflare Monitor → Connect / register → Box 2 → Save & verify (replaces the old one) → revoke the old token in Cloudflare. |
| Rotate `CLOUDFLARE_CREDENTIALS_KEY` | Stored tokens become undecryptable: update the env var, redeploy, then **re-enter every Cloudflare token**. |
| Analysis backlog | Sources → **Analyse pending / failed** (2 per click), or wait for `scheduled-analyze`. |
| False-positive finding | Zone page → finding → status `false_positive` or `accepted_risk` → Set. |
| Reset Cloudflare results (keeps clients) | SQL: delete from `cloudflare_findings`, `cloudflare_access_tests`, `cloudflare_config_changes`, `cloudflare_config_snapshots`, `cloudflare_audits`, `cloudflare_crawler_policies`; reset `cloudflare_zones.health_status`. |
| Full data wipe (keeps users) | `truncate public.clients, public.sources, public.intelligence_items, public.actions cascade;` |

### 9.4 Troubleshooting

| Symptom | Likely cause |
|---|---|
| Login page shows "Supabase is not configured" | `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` missing or misspelled. Fix and redeploy. |
| "Access pending" after sign-in | `profiles.role = 'pending'`. Set the role in Settings or via SQL. |
| "Could not reach Supabase" on sign-in | Wrong Supabase URL (no trailing `/rest/v1`) or wrong key type (use anon/publishable, not service role). |
| Analysis says "ANTHROPIC_API_KEY is not configured" | Missing in Netlify → add → redeploy. |
| Analysis spins then errors | Netlify function time limit. Lower `ANTHROPIC_EFFORT` to `low`. The record stays `failed` and can be retried. |
| Cron logs "URL or CRON_SECRET missing" | Set `CRON_SECRET` in Netlify. |
| Audit check "unavailable: Token lacks permission" | Add that **Read** permission to the Cloudflare token (Cloudflare → API Tokens → Edit). No app change needed. |
| Everything "challenged" in access tests, even the browser baseline | Cloudflare challenges data-centre traffic. Verify manually in a normal browser; rely on the WAF and security-events checks. |

---

## 10. Extending EightSignal

| You want to… | Do this |
|---|---|
| Add a provider | Add an entry to `PROVIDERS` in `src/lib/intel/taxonomy.ts` (key, name, focus, stack keywords), then add its sources in the UI. No migration needed. |
| Add a source type with an API | Add a case in `collect()` (`src/lib/ingestion/run.ts`) returning `CollectedEntry[]`. Add `source_type` to the CHECK constraint via a migration and to the Sources form. |
| Add a crawler identity | Add it to `CRAWLERS` in `src/lib/cloudflare/crawlers.ts` with the correct `class`, `matchTokens`, `robotsTokens` and `uaConfidence`. Tests in `cloudflare-core.test.ts` guard class separation. |
| Add a Cloudflare check | Add a **GET** method to `CloudflareReadOnlyClient`, a pure analysis function returning `DraftFinding[]` with stable key prefixes, call it in `runConfigChecks()`, push a `CheckResult`, add the prefix to `coveredPrefixes` on completion, and add unit tests. |
| Add a page | Create `src/app/(app)/<route>/page.tsx`, call `requireMember()`, put mutations in a sibling `actions.ts` following §5.2, and add the nav item in `components/layout/sidebar.tsx`. |
| Change the analysis output | Update the Zod schema and `validateAnalysis()` → prompt → `ai_analyses` columns (migration) → `AnalysisView` UI → tests. |
| ClickUp / Slack integration | Must be explicit and user-triggered (for example a "Send to ClickUp" button with confirmation). `actions.external_ref` is reserved for the link. Never auto-post. |

### Recommended next steps
1. Create a `main` branch from the deployed branch, switch Netlify's production branch to `main`, and use pull requests for changes.
2. Add a Playwright end-to-end suite against a Supabase dev or branch database.
3. Configure SMTP for Supabase Auth emails.
4. Replace the personal Cloudflare token with a Blend360 **account** API token (created by Blend360's Super Administrator).
5. Regenerate DB types with `supabase gen types typescript` and type the Supabase clients.

---

## 11. Change log (since first release)

| Commit | Change |
|---|---|
| `f0d83be` | Scheduled analysis: newest first, every 5 min, last 30 days only; Overview explains backlog |
| `e7020a2` | Settings: users can set their own password (for invited teammates) |
| `43792b7` | Clients: admin-only delete with typed-name confirmation (cascade documented in §6.1) |
| `ea8bf42` | Access-test findings calibrated for data-centre origin and spoofed UAs |
| `1abdba2` | `global-error.tsx` with digest; hardened password sign-in errors |
| `60f5691` and earlier | Initial platform: schema, RLS, auth, intelligence, AI analysis, Cloudflare Monitor, Action Center, clients, sources, overview, automation, tests, docs |
