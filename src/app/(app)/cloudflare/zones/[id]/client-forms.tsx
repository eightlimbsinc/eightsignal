"use client";

import { useActionState } from "react";
import { Play, ScanSearch } from "lucide-react";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/shared/form";
import { addMonitoredUrl, createTaskFromFinding, recordCrawlerPolicy, runAccessTestsAction, runAudit } from "../../actions";

export function RunAuditForm({ zoneId }: { zoneId: string }) {
  const [state, action] = useActionState(runAudit, {});
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="zone_id" value={zoneId} />
      <SubmitButton size="sm" pendingLabel="Auditing (read-only)…"><Play /> Run full audit</SubmitButton>
      <div className="max-w-md"><FormMessage state={state} /></div>
    </form>
  );
}

export function AccessTestForm({ zoneId, identities }: { zoneId: string; identities: { key: string; name: string }[] }) {
  const [state, action] = useActionState(runAccessTestsAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="zone_id" value={zoneId} />
      <div className="flex gap-2">
        <Select name="identity" defaultValue="all" aria-label="Identity to simulate" className="h-8 text-xs">
          <option value="all">All identities + baseline browser</option>
          {identities.map((i) => <option key={i.key} value={i.key}>{i.name} + baseline</option>)}
        </Select>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Testing…"><ScanSearch /> Test</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function PolicyForm({ zoneId, identityKey, current }: { zoneId: string; identityKey: string; current?: string }) {
  const [state, action] = useActionState(recordCrawlerPolicy, {});
  return (
    <details>
      <summary className="cursor-pointer text-[11px] text-primary hover:underline">Record verified policy</summary>
      <form action={action} className="mt-1.5 flex flex-col gap-1.5">
        <input type="hidden" name="zone_id" value={zoneId} />
        <input type="hidden" name="identity_key" value={identityKey} />
        <Select name="policy" defaultValue={current ?? "unknown"} className="h-8 text-xs" aria-label="Policy">
          {["allow", "block", "challenge", "not_configured", "unknown"].map((p) => <option key={p} value={p}>{p.replace("_", " ")}</option>)}
        </Select>
        <Input name="notes" placeholder="Where verified (e.g. AI Crawl Control)" className="h-8 text-xs" aria-label="Notes" />
        <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
        <FormMessage state={state} />
      </form>
    </details>
  );
}

export function AddUrlForm({ zoneId, domain }: { zoneId: string; domain: string }) {
  const [state, action] = useActionState(addMonitoredUrl, {});
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_10rem_9rem_auto_auto] sm:items-center">
      <input type="hidden" name="zone_id" value={zoneId} />
      <Input name="url" type="url" placeholder={`https://www.${domain}/services/…`} required aria-label="URL" />
      <Input name="label" placeholder="Label" aria-label="Label" />
      <Select name="page_type" defaultValue="service" aria-label="Page type">
        {["homepage", "service", "landing", "blog", "resource", "sitemap", "robots", "page"].map((p) => <option key={p}>{p}</option>)}
      </Select>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" name="is_critical" /> Critical</label>
      <SubmitButton size="sm" variant="secondary">Add URL</SubmitButton>
      <div className="sm:col-span-5"><FormMessage state={state} /></div>
    </form>
  );
}

export function FindingTaskForm({ findingId }: { findingId: string }) {
  const [state, action] = useActionState(createTaskFromFinding, {});
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="finding_id" value={findingId} />
      <SubmitButton size="sm" variant="outline" pendingLabel="Creating…">Create task</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export { Textarea };
