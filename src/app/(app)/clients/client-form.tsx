"use client";

import { useActionState } from "react";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/shared/page";
import { FormMessage, SubmitButton } from "@/components/shared/form";
import type { Client } from "@/lib/types";
import { saveClient } from "./actions";

export function ClientForm({ client }: { client?: Client }) {
  const [state, action] = useActionState(saveClient, {});
  const p = client?.id ?? "new";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {client && <input type="hidden" name="id" value={client.id} />}
      <Field label="Client name" htmlFor={`${p}-name`}><Input id={`${p}-name`} name="name" required defaultValue={client?.name} /></Field>
      <Field label="Website URL" htmlFor={`${p}-web`}><Input id={`${p}-web`} name="website_url" type="url" defaultValue={client?.website_url ?? ""} /></Field>
      <Field label="Industry" htmlFor={`${p}-ind`}><Input id={`${p}-ind`} name="industry" defaultValue={client?.industry ?? ""} /></Field>
      <Field label="CMS / platform" htmlFor={`${p}-plat`}><Input id={`${p}-plat`} name="platform" placeholder="Webflow, WordPress…" defaultValue={client?.platform ?? ""} /></Field>
      <Field label="Hosting provider" htmlFor={`${p}-host`}><Input id={`${p}-host`} name="hosting_provider" placeholder="Netlify, WP Engine…" defaultValue={client?.hosting_provider ?? ""} /></Field>
      <Field label="CDN provider" htmlFor={`${p}-cdn`}><Input id={`${p}-cdn`} name="cdn_provider" placeholder="Cloudflare" defaultValue={client?.cdn_provider ?? ""} /></Field>
      <Field label="Technology stack" htmlFor={`${p}-stack`} hint="Comma separated. Used for impact matching — record only what is confirmed.">
        <Input id={`${p}-stack`} name="technology_stack" defaultValue={client?.technology_stack.join(", ")} placeholder="Cloudflare, Webflow, HubSpot, Claude API" />
      </Field>
      <Field label="Active services" htmlFor={`${p}-svc`} hint="Comma separated, e.g. Technical SEO, AEO, Website management.">
        <Input id={`${p}-svc`} name="active_services" defaultValue={client?.active_services.join(", ")} />
      </Field>
      <div className="sm:col-span-2"><Field label="Internal notes" htmlFor={`${p}-notes`}><Textarea id={`${p}-notes`} name="notes" rows={3} defaultValue={client?.notes ?? ""} /></Field></div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <SubmitButton size="sm">{client ? "Save client" : "Register client"}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
