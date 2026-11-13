"use client";

import { useActionState } from "react";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/shared/page";
import { FormMessage, SubmitButton } from "@/components/shared/form";
import { CATEGORIES, PROVIDERS } from "@/lib/intel/taxonomy";
import { createSource, deleteSource, reprocessPending, runSourceNow } from "./actions";

export function RunNowForm({ id }: { id: string }) {
  const [state, action] = useActionState(runSourceNow, {});
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="outline" pendingLabel="Collecting…">Run now</SubmitButton>
      <div className="max-w-xs"><FormMessage state={state} /></div>
    </form>
  );
}

export function ReprocessForm() {
  const [state, action] = useActionState(reprocessPending, {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <SubmitButton size="sm" variant="secondary" pendingLabel="Analysing…">Analyse pending / failed</SubmitButton>
      <div className="max-w-sm"><FormMessage state={state} /></div>
    </form>
  );
}

export function SourceForm() {
  const [state, action] = useActionState(createSource, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <Field label="Name" htmlFor="s-name"><Input id="s-name" name="name" required /></Field>
      <Field label="Provider" htmlFor="s-prov"><Select id="s-prov" name="provider" defaultValue="cloudflare">{PROVIDERS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
      <Field label="Type" htmlFor="s-type">
        <Select id="s-type" name="source_type" defaultValue="rss">
          <option value="rss">RSS feed</option><option value="atom">Atom feed</option>
          <option value="changelog_page">Changelog page</option><option value="announcement_page">Announcement page</option>
        </Select>
      </Field>
      <div className="sm:col-span-2"><Field label="Official URL" htmlFor="s-url"><Input id="s-url" name="source_url" type="url" required /></Field></div>
      <Field label="Default category" htmlFor="s-cat"><Select id="s-cat" name="default_category" defaultValue="product">{CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select></Field>
      <div className="sm:col-span-2"><Field label="Link pattern (pages only)" htmlFor="s-pat" hint="Regex matched against link paths on the listing page, e.g. ^/changelog/[^/]+"><Input id="s-pat" name="link_pattern" /></Field></div>
      <Field label="Check every (minutes)" htmlFor="s-int"><Input id="s-int" name="check_interval_minutes" type="number" min={15} defaultValue={360} /></Field>
      <div className="flex flex-col gap-2 sm:col-span-3">
        <SubmitButton size="sm">Add source</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function DeleteSourceForm({ id, name, articleCount }: { id: string; name: string; articleCount: number }) {
  const [state, action] = useActionState(deleteSource, {});
  return (
    <details>
      <summary className="cursor-pointer text-[11px] text-rose-300 hover:underline">Delete…</summary>
      <form action={action} className="mt-1.5 flex w-64 flex-col gap-1.5 rounded-md border border-sev-critical/30 p-2">
        <input type="hidden" name="id" value={id} />
        <p className="text-[11px] text-muted-foreground">Stops collecting from <strong className="text-foreground">{name}</strong> and removes its collection history.</p>
        <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" name="also_articles" defaultChecked /> Also delete its {articleCount} article(s)</label>
        <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" name="confirm" required /> I understand this cannot be undone</label>
        <SubmitButton size="sm" variant="destructive" pendingLabel="Deleting…">Delete source</SubmitButton>
        <FormMessage state={state} />
      </form>
    </details>
  );
}
