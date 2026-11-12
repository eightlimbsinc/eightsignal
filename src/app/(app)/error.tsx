"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-16 max-w-lg rounded-lg border border-sev-critical/40 bg-sev-critical/5 p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-rose-200">
        <AlertTriangle className="size-4" aria-hidden /> Something went wrong loading this page
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {error.digest ? `Reference: ${error.digest}. ` : ""}Check that Supabase is reachable and migrations are applied.
      </p>
      <Button className="mt-4" size="sm" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
