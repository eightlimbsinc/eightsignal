# ADR 0003 — Cloudflare integration is read-only and advisory

**Status:** accepted · 2026-11-12

## Decision
- `CloudflareReadOnlyClient` exposes GET methods only, plus the GraphQL Analytics query
  endpoint. There is no method that can create, modify, reorder or delete configuration.
- Scoped API tokens only; Global API Keys are rejected by shape. Tokens are stored
  AES-256-GCM-encrypted (`CLOUDFLARE_CREDENTIALS_KEY`) in a table with RLS and no policies,
  or referenced by environment-variable name. Only the last four characters are displayed.
- Capabilities a token cannot read are reported per check as `unavailable`; settings with
  no API used by EightSignal (AI Crawl Control per-crawler policy) are marked
  `manual_verification` and recorded by analysts with `policy_source = 'manual'`.
- Health is computed from completed checks and open findings, never from connectivity alone.
- Findings carry a stable key so repeat audits update rather than duplicate them; findings
  from checks that completed but no longer detect the issue are auto-resolved.
- Simulated crawler requests are clearly labelled; verified traffic can only be inferred
  from Cloudflare security events.

## Future write operations
Any future write (e.g. proposing a WAF change) must: be a separate, explicitly enabled
capability with a separately scoped token; present a diff for human approval; record
approver, timestamp and before/after snapshot in an audit trail; and never run from a
scheduled job.
