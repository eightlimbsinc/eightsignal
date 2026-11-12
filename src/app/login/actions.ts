"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import type { ActionState } from "@/lib/action-state";
import { isSupabaseConfigured } from "@/lib/env";

export async function signInWithPassword(_: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: "Supabase is not configured." };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };
  try {
    const db = await createClient();
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("[login] Supabase rejected sign-in:", error.status, error.code, error.message);
      if (error.status === 400 || error.code === "invalid_credentials") return { error: "Invalid email or password." };
      return { error: `Sign-in failed (${error.code ?? error.status ?? "unknown"}). Check the Supabase URL/key settings.` };
    }
  } catch (e) {
    console.error("[login] sign-in threw:", e);
    return { error: "Could not reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL and the anon/publishable key in Netlify." };
  }
  redirect(safeNextPath(String(formData.get("next") ?? "/")));
}

export async function sendMagicLink(_: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: "Supabase is not configured." };
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Email is required." };
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const db = await createClient();
  // Invite-only: never create accounts from the login form.
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error && !/not found|signups not allowed/i.test(error.message)) return { error: "Could not send the sign-in link. Try again shortly." };
  // Same response whether or not the account exists (no user enumeration).
  return { ok: true, message: "If this email has access, a sign-in link is on its way." };
}
