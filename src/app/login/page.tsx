import { Activity } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : "/");
  const configured = isSupabaseConfigured();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="size-4" aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Eight<span className="text-primary">Signal</span>
          </span>
        </div>
        <h1 className="text-base font-semibold">Sign in</h1>
        <p className="mb-5 mt-1 text-xs text-muted-foreground">
          Internal intelligence platform for 8limbs Inc. Access is by invitation only.
        </p>
        {configured ? (
          <LoginForm next={next} />
        ) : (
          <div role="alert" className="rounded-md border border-sev-medium/40 bg-sev-medium/10 p-3 text-xs text-yellow-100">
            Supabase is not configured. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (see README).
          </div>
        )}
        {typeof sp.error === "string" && (
          <p role="alert" className="mt-3 text-xs text-rose-300">The sign-in link is invalid or expired.</p>
        )}
        <p className="mt-8 text-[11px] text-muted-foreground">
          Know what changes. Understand what matters. Act before it becomes a problem.
        </p>
      </div>
    </div>
  );
}
