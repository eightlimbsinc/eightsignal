"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/shared/form";
import { sendMagicLink, signInWithPassword } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [pwState, pwAction] = useActionState(signInWithPassword, {});
  const [linkState, linkAction] = useActionState(sendMagicLink, {});
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 rounded-md border p-0.5 text-xs">
        {(["password", "link"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded px-2 py-1.5 ${mode === m ? "bg-accent text-foreground" : "text-muted-foreground"}`}
          >
            {m === "password" ? "Password" : "Email link"}
          </button>
        ))}
      </div>
      {mode === "password" ? (
        <form action={pwAction} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label className="sr-only" htmlFor="email">Email</label>
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
          <label className="sr-only" htmlFor="password">Password</label>
          <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="Password" required />
          <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
          <FormMessage state={pwState} />
        </form>
      ) : (
        <form action={linkAction} className="flex flex-col gap-3">
          <label className="sr-only" htmlFor="link-email">Email</label>
          <Input id="link-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
          <SubmitButton pendingLabel="Sending…">Email me a sign-in link</SubmitButton>
          <FormMessage state={linkState} />
        </form>
      )}
    </div>
  );
}
