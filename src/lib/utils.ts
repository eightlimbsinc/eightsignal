import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "UTC",
  }) + (withTime ? " UTC" : "");
}

export function relativeTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "never";
  const diff = now - new Date(value).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

export function truncate(input: string | null | undefined, max: number): string {
  if (!input) return "";
  return input.length > max ? `${input.slice(0, max - 1).trimEnd()}…` : input;
}

/** Split a comma/newline separated string into trimmed unique values. */
export function splitList(input: FormDataEntryValue | null | undefined): string[] {
  if (typeof input !== "string") return [];
  return [...new Set(input.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
}
