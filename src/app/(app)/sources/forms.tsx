"use client";

import { useActionState } from "react";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/shared/page";
import { FormMessage, SubmitButton } from "@/components/shared/form";
import { CATEGORIES, PROVIDERS } from "@/lib/intel/taxonomy";
import { createSource, reprocessPending, runSourceNow } from "./actions";

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
