# Implementation status — 2026-11-12

Honest per-phase report. "Verified" means exercised in this repository's automated
checks; "not verified live" means the code path exists but has not yet run against the
real external service.

## Verification performed

| Check | Result |
|---|---|
| `npm run build` (Next.js 16.4.6, Turbopack) | Passes; 22 routes + proxy |
| `npm run typecheck`, `npm run lint` | Clean |
| `npm test` (Vitest) | 83 tests pass |
| `npm run test:db` | All 3 migrations apply on PostgreSQL 16 as a non-superuser, non-BYPASSRLS owner; RLS assertions pass |
| Render smoke test | Every page returned 200 when signed in, against a local mock of Supabase Auth/REST with fixture data; anonymous requests redirect to `/login`; cron without secret is refused; no browser console errors; no horizontal scroll at 390px and 1440px |

**Not verified live** (the build environment had no network access to these services):
a real Supabase project, the Anthropic API, the Cloudflare API, Blend360's website and
Netlify. These need a first-run check after deployment (see "First-run checklist").

## Phase summary

| Phase | State | Notes |
|---|---|---|
| 1 Foundation | Done | Next.js/TS/Tailwind/shadcn-style UI, Supabase SSR auth (password + invite-only magic link), pending-approval gate, roles, migrations, RLS, collapsible sidebar shell, Netlify config. Not yet deployed. |
| 2 Intelligence management | Done | Feed, filters, search, pagination, bookmarks, read/unread, notes, detail pages, manual entry, SSRF-safe URL extraction, canonical-URL + fingerprint dedupe. |
| 3 AI analysis | Done, not verified live | Structured Claude analysis (what/why/who/risk/opportunity/actions/departments/impact/confidence/source classification), re-analysis with history, per-user rate limit, client mapping. |
| 4 Cloudflare Monitor | Done, not verified live against Cloudflare | Accounts, encrypted/env tokens, zones, monitored URLs, read-only config retrieval, WAF/redirect/bot/robots/security-event/audit-log checks, access tests, snapshots + diffs + comparison, findings lifecycle, change history, health, AI access matrix, incident log. |
| 5 Action Center | Done | Create from recommendations/findings/manual, assign, due dates, priorities, five statuses, comments, links to intelligence/clients/findings. |
| 6 Automation | Done, not verified on Netlify | RSS/Atom/changelog/announcement collectors, retries, back-off, history, manual runs/reprocessing, three scheduled functions. |
| 7 Client intelligence | Done | Registry with manual stacks/services, AI + rule-based impact suggestions, review status, owner, per-client view. |

## First-run checklist (after deploying)

1. Apply migrations; promote the first admin (README → First admin).
2. Set all env vars, including `CRON_SECRET` and `CLOUDFLARE_CREDENTIALS_KEY`.
3. Submit one official URL and press **Analyse with Claude** — confirms the Anthropic key,
   model access and function timeout.
4. **Cloudflare:** register the Blend360 account, add a scoped read-only token, confirm
   "verified", link the zone and **Run full audit**. Review the per-check list: any
   `unavailable` check names the missing permission. In particular confirm:
   - the GraphQL `firewallEventsAdaptive` query fields (`action source ruleId clientRequestPath userAgent datetime`) are accepted for the zone's plan;
   - the `bot_management` response includes the AI-bot field on Blend360's plan;
   - the account audit-log endpoint is readable with the token.
5. Verify `blend360.com` is the correct zone and add service/landing/blog URLs.
6. Activate sources one by one after **Run now** succeeds (seeded URLs are unverified).
7. Check Netlify → Functions → Scheduled to confirm the three schedules are registered.

## Known limitations

- **Crawler user-agent strings** for Claude-SearchBot, Claude-User, Claude-Agent and
  Perplexity-User are product-token approximations (marked "UA token only" in the UI).
  Verify against provider documentation before relying on simulated tests for them.
- **AI Crawl Control per-crawler policies** are not read via API; they are recorded
  manually and shown as "manually verified".
- **Simulated tests ≠ verified traffic.** Requests come from Netlify's network with a
  spoofed UA; Cloudflare may legitimately block them. Verified-bot treatment is inferred
  only from security events.
- **Function time limits** may cut off slow Claude analyses; failures are recorded and
  can be retried (README → Netlify limits).
- **Alerts are in-app only** (Needs Attention, sidebar badge, change history). No email,
  Slack or ClickUp notifications are sent — by design until explicitly authorised.
- `api` source type has no adapter yet; provider APIs need specific adapters.
- Database types are hand-written; regenerate with `supabase gen types` when convenient.
- No end-to-end tests against a live Supabase instance yet (Playwright suite is a good next step).
- The AI rate limit is per user; there is no organisation-wide token budget.

## Suggested next work

1. Deploy to Netlify and run the first-run checklist; fix anything the live services reject.
2. Playwright E2E suite against a Supabase branch database.
3. Optional email/Slack digests of Needs Attention (behind explicit opt-in).
4. ClickUp export of tasks (manual "Send to ClickUp" with confirmation).
5. More provider adapters (Google, Microsoft, Perplexity) via the provider registry.
