import { Badge } from "@/components/ui/badge";
import type { HealthStatus } from "@/lib/types";

const SEV_VARIANT = {
  critical: "critical", high: "high", medium: "medium", low: "low", info: "info", informational: "info", unassessed: "outline",
} as const;

export function SeverityBadge({ level, className }: { level: string; className?: string }) {
  const variant = SEV_VARIANT[level as keyof typeof SEV_VARIANT] ?? "outline";
  return (
    <Badge variant={variant} className={className}>
      {level === "unassessed" ? "Unassessed" : level.charAt(0).toUpperCase() + level.slice(1)}
    </Badge>
  );
}

const HEALTH: Record<HealthStatus, { label: string; variant: "ok" | "medium" | "high" | "critical" | "outline" }> = {
  healthy: { label: "Healthy", variant: "ok" },
  needs_review: { label: "Needs Review", variant: "medium" },
  warning: { label: "Warning", variant: "high" },
  critical: { label: "Critical", variant: "critical" },
  not_connected: { label: "Not Connected", variant: "outline" },
};

export function HealthBadge({ status }: { status: HealthStatus }) {
  const h = HEALTH[status] ?? HEALTH.not_connected;
  return <Badge variant={h.variant}>{h.label}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  const variant =
    status === "completed" || status === "resolved" || status === "accessible" || status === "connected" || status === "success"
      ? "ok"
      : status === "failed" || status === "error" || status === "blocked" || status === "critical"
        ? "critical"
        : status === "challenged" || status === "partial" || status === "warning"
          ? "high"
          : status === "running" || status === "in_progress" || status === "redirected"
            ? "default"
            : "secondary";
  return <Badge variant={variant} className="capitalize">{label}</Badge>;
}
