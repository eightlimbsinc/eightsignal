"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

export function SubmitButton({
  children,
  pendingLabel,
  variant,
  size,
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={variant} size={size} className={className} aria-busy={pending}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.error && !state.message) return null;
  return (
    <div
      role={state.error ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        state.error ? "border-sev-critical/40 bg-sev-critical/10 text-rose-200" : "border-ok/40 bg-ok/10 text-green-200",
      )}
    >
      {state.error ?? state.message}
      {state.href && (
        <>
          {" "}
          <Link href={state.href} className="underline underline-offset-2">
            Open
          </Link>
        </>
      )}
    </div>
  );
}

/**
 * Generic form wrapper around a server action with inline success/error states.
 * `resetOnSuccess` clears inputs after a successful submission.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={cn("flex flex-col gap-3", className)}>
      {children}
      <FormMessage state={state} />
    </form>
  );
}
