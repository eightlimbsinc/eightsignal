/**
 * Centralised, validated access to server-side configuration.
 * Never import this module from client components.
 */
import "server-only";

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function required(name: string): string {
  const v = optional(name);
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const serverEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  anthropicApiKey: () => optional("ANTHROPIC_API_KEY"),
  anthropicModel: () => optional("ANTHROPIC_MODEL") ?? "claude-opus-5-5",
  anthropicEffort: () =>
    (optional("ANTHROPIC_EFFORT") as "low" | "medium" | "high" | undefined) ?? "medium",
  aiAnalysesPerHour: () => Number(optional("AI_ANALYSES_PER_USER_PER_HOUR") ?? "30"),
  appUrl: () => optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  cronSecret: () => optional("CRON_SECRET"),
  credentialsKey: () => optional("CLOUDFLARE_CREDENTIALS_KEY"),
  autoAnalyzeIngested: () => optional("AUTO_ANALYZE_INGESTED") !== "false",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(optional("NEXT_PUBLIC_SUPABASE_URL") && optional("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
}
