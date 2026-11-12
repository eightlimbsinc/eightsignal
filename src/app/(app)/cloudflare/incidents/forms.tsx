"use client";

import { useActionState } from "react";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/shared/page";
import { FormMessage, SubmitButton } from "@/components/shared/form";
import { saveIncident } from "../actions";

type Opt = { id: string; name: string };
export interface IncidentInput {
  id?: string;
  client_id?: string;
  zone_id?: string | null;
  title?: string;
  incident_type?: string;
  description?: string;
  severity?: string;
  incident_date?: string;
  status?: string;
  resolution_notes?: string | null;
}

const TYPES = [
  ["suspicious_admin_activity", "Suspicious administrative activity"],
  ["unauthorized_config_change", "Unauthorized configuration change"],
  ["suspicious_redirect", "Suspicious redirect rule"],
  ["unexpected_traffic", "Unexpected traffic pattern"],
  ["investigation", "Security investigation"],
  ["other", "Other"],
];

export function IncidentForm({ clients, zones, incident }: { clients: Opt[]; zones: Opt[]; incident?: IncidentInput }) {
  const [state, action] = useActionState(saveIncident, {});
  const p = incident?.id ?? "new";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {incident?.id && <input type="hidden" name="id" value={incident.id} />}
      <Field label="Title" htmlFor={`${p}-title`}><Input id={`${p}-title`} name="title" required defaultValue={incident?.title} /></Field>
      <Field label="Type" htmlFor={`${p}-type`}>
        <Select id={`${p}-type`} name="incident_type" defaultValue={incident?.incident_type ?? "investigation"}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Client" htmlFor={`${p}-client`}>
        <Select id={`${p}-client`} name="client_id" required defaultValue={incident?.client_id ?? clients.find((c) => /blend360/i.test(c.name))?.id ?? ""}>
          <option value="" disabled>Choose…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Zone (optional)" htmlFor={`${p}-zone`}>
        <Select id={`${p}-zone`} name="zone_id" defaultValue={incident?.zone_id ?? ""}>
          <option value="">—</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <Field label="Severity" htmlFor={`${p}-sev`}>
          <Select id={`${p}-sev`} name="severity" defaultValue={incident?.severity ?? "medium"}>
            {["critical", "high", "medium", "low"].map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Date" htmlFor={`${p}-date`}><Input id={`${p}-date`} type="date" name="incident_date" required defaultValue={incident?.incident_date ?? new Date().toISOString().slice(0, 10)} /></Field>
        <Field label="Status" htmlFor={`${p}-status`}>
          <Select id={`${p}-status`} name="status" defaultValue={incident?.status ?? "open"}>
            {["open", "investigating", "contained", "resolved", "closed"].map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Description" htmlFor={`${p}-desc`}><Textarea id={`${p}-desc`} name="description" required rows={4} defaultValue={incident?.description} /></Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Resolution notes" htmlFor={`${p}-res`}><Textarea id={`${p}-res`} name="resolution_notes" rows={3} defaultValue={incident?.resolution_notes ?? ""} /></Field>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <SubmitButton size="sm">{incident?.id ? "Update incident" : "Record incident"}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
