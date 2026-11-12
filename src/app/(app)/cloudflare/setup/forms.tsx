"use client";

import { useActionState, useState } from "react";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/shared/page";
import { FormMessage, SubmitButton } from "@/components/shared/form";
import { createAccount, createZone, saveCredential } from "../actions";

type Opt = { id: string; name: string };

export function AccountForm({ clients }: { clients: Opt[] }) {
  const [state, action] = useActionState(createAccount, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Client" htmlFor="acc-client">
        <Select id="acc-client" name="client_id" required defaultValue={clients.find((c) => /blend360/i.test(c.name))?.id ?? ""}>
          <option value="" disabled>Choose…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Account label" htmlFor="acc-name"><Input id="acc-name" name="account_name" required placeholder="Blend360 production" /></Field>
      <Field label="Cloudflare account ID (optional)" htmlFor="acc-id" hint="Needed to read the account audit log and to verify account-owned tokens.">
        <Input id="acc-id" name="account_identifier" placeholder="32 hex characters" />
      </Field>
      <SubmitButton size="sm">Register account</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function CredentialForm({ accounts }: { accounts: Opt[] }) {
  const [state, action] = useActionState(saveCredential, {});
  const [storage, setStorage] = useState<"encrypted" | "env">("encrypted");
  return (
    <form action={action} className="flex flex-col gap-3" autoComplete="off">
      <Field label="Account" htmlFor="cred-acc">
        <Select id="cred-acc" name="account_id" required defaultValue="">
          <option value="" disabled>Choose…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Field>
      <fieldset className="flex gap-4 text-xs">
        <legend className="sr-only">Storage</legend>
        <label className="flex items-center gap-1.5"><input type="radio" name="storage" value="encrypted" checked={storage === "encrypted"} onChange={() => setStorage("encrypted")} /> Encrypted in database</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="storage" value="env" checked={storage === "env"} onChange={() => setStorage("env")} /> Server environment variable</label>
      </fieldset>
      {storage === "encrypted" ? (
        <Field label="Scoped API token" htmlFor="cred-token" hint="Sent once to the server, encrypted with AES-256-GCM, never shown again. Global API Keys are rejected.">
          <Input id="cred-token" name="token" type="password" required autoComplete="new-password" spellCheck={false} />
        </Field>
      ) : (
        <Field label="Environment variable name" htmlFor="cred-env" hint="Set this variable in Netlify; only its name is stored.">
          <Input id="cred-env" name="env_var_name" required placeholder="CLOUDFLARE_TOKEN_BLEND360" />
        </Field>
      )}
      <SubmitButton size="sm" pendingLabel="Verifying…">Save &amp; verify token</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ZoneForm({ clients, accounts }: { clients: Opt[]; accounts: (Opt & { client_id: string })[] }) {
  const [state, action] = useActionState(createZone, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Client" htmlFor="zone-client">
        <Select id="zone-client" name="client_id" required defaultValue={clients.find((c) => /blend360/i.test(c.name))?.id ?? ""}>
          <option value="" disabled>Choose…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Domain" htmlFor="zone-domain"><Input id="zone-domain" name="domain" required placeholder="blend360.com" /></Field>
      <Field label="Cloudflare account (optional)" htmlFor="zone-acc">
        <Select id="zone-acc" name="cloudflare_account_id" defaultValue="">
          <option value="">None — HTTP checks only</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Field>
      <Field label="Zone ID (optional)" htmlFor="zone-id" hint="Auto-detected from the domain during the first audit if omitted.">
        <Input id="zone-id" name="zone_identifier" placeholder="32 hex characters" />
      </Field>
      <SubmitButton size="sm">Register zone</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
