import { createHash } from "node:crypto";

/** Deterministic JSON (sorted keys) so equal configurations hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function configHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Fields that change on every save without changing behaviour. */
const VOLATILE = new Set(["version", "last_updated", "modified_on", "etag"]);

export interface ConfigDiffEntry {
  kind: "added" | "removed" | "modified";
  id: string;
  label: string;
  changes?: { field: string; before: unknown; after: unknown }[];
  before?: unknown;
  after?: unknown;
}

type Keyed = Record<string, unknown> & { id?: string; description?: string; name?: string };

function itemsOf(config: unknown): Keyed[] | null {
  if (Array.isArray(config)) return config as Keyed[];
  if (config && typeof config === "object" && Array.isArray((config as { rules?: unknown }).rules)) {
    return (config as { rules: Keyed[] }).rules;
  }
  return null;
}

/**
 * Diffs two snapshots. Rule lists are compared by rule id (detecting additions,
 * removals, field changes and re-ordering); other objects are compared field by field.
 */
export function diffConfigs(before: unknown, after: unknown): ConfigDiffEntry[] {
  const a = itemsOf(before);
  const b = itemsOf(after);
  if (a && b) {
    const out: ConfigDiffEntry[] = [];
    const mapA = new Map(a.map((r, i) => [String(r.id ?? `idx-${i}`), { r, i }]));
    const mapB = new Map(b.map((r, i) => [String(r.id ?? `idx-${i}`), { r, i }]));
    for (const [id, { r }] of mapB) {
      if (!mapA.has(id)) out.push({ kind: "added", id, label: labelOf(r, id), after: r });
    }
    for (const [id, { r }] of mapA) {
      if (!mapB.has(id)) out.push({ kind: "removed", id, label: labelOf(r, id), before: r });
    }
    for (const [id, { r: rb, i: ib }] of mapB) {
      const prev = mapA.get(id);
      if (!prev) continue;
      const changes = fieldChanges(prev.r, rb);
      if (prev.i !== ib) changes.push({ field: "position", before: prev.i + 1, after: ib + 1 });
      if (changes.length) out.push({ kind: "modified", id, label: labelOf(rb, id), changes });
    }
    return out;
  }
  const changes = fieldChanges((before ?? {}) as Record<string, unknown>, (after ?? {}) as Record<string, unknown>);
  return changes.length ? [{ kind: "modified", id: "config", label: "Configuration", changes }] : [];
}

function labelOf(r: Keyed, id: string): string {
  return String(r.description ?? r.name ?? id);
}

function fieldChanges(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const out: { field: string; before: unknown; after: unknown }[] = [];
  for (const k of [...keys].sort()) {
    if (VOLATILE.has(k)) continue;
    if (canonicalJson(a?.[k]) !== canonicalJson(b?.[k])) out.push({ field: k, before: a?.[k] ?? null, after: b?.[k] ?? null });
  }
  return out;
}
