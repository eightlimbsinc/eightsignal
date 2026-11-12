import type { Severity } from "@/lib/types";

/** A finding produced by an audit before it is persisted. `key` is stable across runs. */
export interface DraftFinding {
  key: string;
  type: string;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  evidence: Record<string, unknown>;
  identities: string[];
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export function maxSeverity(list: Severity[]): Severity | null {
  return list.reduce<Severity | null>((acc, s) => (!acc || SEVERITY_RANK[s] > SEVERITY_RANK[acc] ? s : acc), null);
}
