# ADR 0004 — Ingestion adapters and duplicate detection

**Status:** accepted · 2026-11-12

## Decision
- One collector per source type (`rss`, `atom`, `changelog_page`, `announcement_page`;
  `api` is reserved for provider-specific adapters). Listing-page collectors extract links
  matching a configured path pattern; dates are left empty rather than guessed.
- Sources are created inactive; an analyst verifies them with "Run now" first.
- Retries with exponential back-off for network errors, 429 and 5xx; per-run deadline;
  sequential collection with a delay; failing sources back off (interval × 2^failures, max 8×).
- Duplicates: canonical URL (scheme/host normalised, tracking params and fragments
  removed, query sorted) **and** a SHA-256 content fingerprint of normalised title + first
  2,000 characters of body. Both are unique-indexed in Postgres as the final guard.
- Unreachable sources produce an error log entry and never a placeholder record.
