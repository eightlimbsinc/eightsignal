"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/shared/form";
import { PROVIDERS } from "@/lib/intel/taxonomy";
import { deleteUnassessed } from "./actions";

export function BulkDeleteUnassessed({ counts }: { counts: { total: number; byProvider: Record<string, number> } }) {
  const [state, action] = useActionState(deleteUnassessed, {});
  return (
    <details className="mb-4 rounded-lg border border-sev-critical/30 bg-card px-4 py-3">
      <summary className="cursor-pointer text-xs text-rose-300">
        Delete unassessed articles ({counts.total}) — admin
      </summary>
      <form action={action} className="mt-3 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Permanently deletes every article Claude has not assessed yet (impact &quot;Unassessed&quot;), including ones still waiting
          for automatic analysis. Articles being analysed right now are skipped. Deleted articles are remembered, so active sources
          won&apos;t collect them again (you can still add one back manually). Tasks are kept.
        </p>
        <div className="grid gap-2 sm:grid-cols-[14rem_10rem_auto] sm:items-center">
          <Select name="provider" defaultValue="" aria-label="Provider">
            <option value="">All providers ({counts.total})</option>
            {PROVIDERS.filter((p) => counts.byProvider[p.key]).map((p) => (
              <option key={p.key} value={p.key}>{p.name} ({counts.byProvider[p.key]})</option>
            ))}
          </Select>
          <Input name="confirm_text" placeholder="Type DELETE" autoComplete="off" required aria-label="Type DELETE to confirm" />
          <SubmitButton size="sm" variant="destructive" pendingLabel="Deleting…"><Trash2 /> Delete unassessed</SubmitButton>
        </div>
        <FormMessage state={state} />
      </form>
    </details>
  );
}
