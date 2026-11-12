import { IMPACT_RANK } from "./taxonomy";

/**
 * "Signals That Matter" score: impact dominates, recency decays it (half-life
 * 14 days), unresolved work and client exposure add weight. Newest is NOT the sort key.
 */
export function signalScore(
  item: { impact_level: string; published_at: string | null; discovered_at: string; status: string },
  extras: { clientImpacts: number; openActions: number },
  now = Date.now(),
): number {
  const impact = IMPACT_RANK[item.impact_level] ?? 0;
  if (impact === 0) return 0;
  const ts = new Date(item.published_at ?? item.discovered_at).getTime();
  const ageDays = Math.max(0, (now - ts) / 86_400_000);
  const recency = Math.pow(0.5, ageDays / 14);
  const closed = ["archived", "dismissed"].includes(item.status) ? 0.2 : 1;
  const exposure = 1 + Math.min(extras.clientImpacts, 5) * 0.15 + (extras.openActions > 0 ? 0.1 : 0);
  return impact ** 2 * (0.35 + 0.65 * recency) * exposure * closed;
}
