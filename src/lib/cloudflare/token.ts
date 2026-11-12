import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { decryptSecret, encryptSecret, parseKey } from "./credentials";

/** Resolves the API token for a Cloudflare account. Requires the service-role client. */
export async function resolveToken(admin: SupabaseClient, cloudflareAccountId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("cloudflare_credentials")
    .select("storage, encrypted_token, env_var_name")
    .eq("cloudflare_account_id", cloudflareAccountId)
    .maybeSingle();
  if (error) throw new Error(`Could not load credentials: ${error.message}`);
  if (!data) return null;
  if (data.storage === "env") {
    const v = data.env_var_name ? process.env[data.env_var_name] : undefined;
    return v && v.trim() ? v.trim() : null;
  }
  return decryptSecret(data.encrypted_token as string, parseKey(serverEnv.credentialsKey()));
}

export function encryptToken(token: string): string {
  return encryptSecret(token.trim(), parseKey(serverEnv.credentialsKey()));
}
