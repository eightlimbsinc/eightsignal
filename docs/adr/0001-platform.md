# ADR 0001 — Next.js 16 on Netlify with Supabase

**Status:** accepted · 2026-11-12

## Context
The brief specifies Next.js, Supabase and Netlify, and warns that Next.js server features
may behave differently on Netlify.

## Decision
- Next.js **16.4** (App Router). Verified that `@netlify/plugin-nextjs` 5.16.x (OpenNext
  adapter, released Nov 2026) handles Node.js middleware/`proxy` manifests; the plugin is
  pinned in `netlify.toml`.
- Session refresh uses `src/proxy.ts` (Next 16's replacement for `middleware.ts`, Node runtime).
- **Cache Components / PPR are disabled.** Every page is per-user and RLS-filtered, so
  there is nothing to cache across users, and it avoids depending on adapter support for
  newer caching features.
- No web fonts are fetched at build time (system font stack) so builds don't depend on
  external font hosts.
- Server Actions handle mutations; route handlers exist only for auth callbacks and cron.
- Supabase types are hand-maintained in `src/lib/types.ts` (generated types can replace
  them later with `supabase gen types`).

## Consequences
Long-running work (Claude analysis, multi-request audits) must fit in a single function
invocation. Scheduled work is chunked (one record / one zone per call) and state is
persisted so timeouts are recoverable.
