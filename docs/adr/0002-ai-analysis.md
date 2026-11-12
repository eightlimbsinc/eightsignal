# ADR 0002 — Structured Claude analysis with untrusted-content isolation

**Status:** accepted · 2026-11-12

## Decision
- Official `@anthropic-ai/sdk`, server-side only. `client.beta.messages.parse` with a Zod
  schema (`betaZodOutputFormat`) for structured outputs, model `claude-opus-5-5` by default
  (configurable), `output_config.effort` configurable (default `medium`).
- Server-side refusal fallback (`fallbacks: "default"`) is enabled so a safety-classifier
  decline on the primary model is retried on a fallback model; a final `refusal` is
  surfaced as a non-retryable error.
- The schema avoids keywords structured outputs may not support (min/max); business rules
  (confidence 0–1, non-empty sections, registry-only client names, deduped teams) are
  enforced in `validateAnalysis`.
- Retrieved content is wrapped in `<untrusted_source_content>`; attempts to close the tag
  are neutralised; the system prompt forbids following embedded instructions, fabricating
  facts/dates, or recommending automatic production changes. The model must classify the
  source (verified announcement vs. commentary/speculation/prediction) and justify confidence.
- Each analysis is stored as a new row; previous rows are kept with `is_current = false`
  (re-analysis history).
- Client mapping combines AI suggestions (validated against the registry) with a
  deterministic stack-keyword match; all start as `suggested` until a human confirms.

## Consequences
Analyses can take tens of seconds; see Netlify limits in the README.
