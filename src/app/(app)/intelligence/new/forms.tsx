"use client";

import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/shared/page";
import { FormMessage, SubmitButton } from "@/components/shared/form";
import { CATEGORIES, PROVIDERS } from "@/lib/intel/taxonomy";
import { createManualEntry, submitUrl } from "../actions";

function ProviderCategory({ idPrefix }: { idPrefix: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Provider" htmlFor={`${idPrefix}-provider`}>
        <Select id={`${idPrefix}-provider`} name="provider" defaultValue="cloudflare" required>
          {PROVIDERS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Category" htmlFor={`${idPrefix}-category`}>
        <Select id={`${idPrefix}-category`} name="category" defaultValue="product" required>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </Select>
      </Field>
    </div>
  );
}

export function NewIntelligenceForms() {
  const [urlState, urlAction] = useActionState(submitUrl, {});
  const [manualState, manualAction] = useActionState(createManualEntry, {});
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Submit a URL</CardTitle>
          <CardDescription>
            EightSignal fetches the page server-side (private networks blocked), extracts the title, date and text, and stores the original link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={urlAction} className="flex flex-col gap-3">
            <Field label="URL" htmlFor="url">
              <Input id="url" name="url" type="url" placeholder="https://blog.cloudflare.com/…" required />
            </Field>
            <ProviderCategory idPrefix="url" />
            <SubmitButton pendingLabel="Fetching and extracting…">Extract and save</SubmitButton>
            <FormMessage state={urlState} />
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Manual entry</CardTitle>
          <CardDescription>For developments without a fetchable page (briefings, partner emails, internal findings).</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={manualAction} className="flex flex-col gap-3">
            <Field label="Title" htmlFor="title">
              <Input id="title" name="title" required maxLength={500} />
            </Field>
            <ProviderCategory idPrefix="manual" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Original source URL (optional)" htmlFor="source_url">
                <Input id="source_url" name="source_url" type="url" />
              </Field>
              <Field label="Publication date (optional)" htmlFor="published_at">
                <Input id="published_at" name="published_at" type="date" />
              </Field>
            </div>
            <Field label="Summary" htmlFor="summary">
              <Textarea id="summary" name="summary" rows={2} maxLength={5000} />
            </Field>
            <Field label="Content" htmlFor="content" hint="Paste the announcement text. Treated as untrusted data during AI analysis.">
              <Textarea id="content" name="content" rows={8} />
            </Field>
            <SubmitButton pendingLabel="Saving…">Save record</SubmitButton>
            <FormMessage state={manualState} />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
