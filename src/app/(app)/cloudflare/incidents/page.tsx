import Link from "next/link";
import { ArrowLeft, Siren } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/shared/page";
import { SeverityBadge, StatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { IncidentForm } from "./forms";

export const metadata = { title: "Security incident log" };

export default async function IncidentsPage() {
  const { db, profile } = await requireMember();
  const editor = canEdit(profile);
  if (!editor) {
    return (
      <EmptyState className="mt-10" icon={Siren} title="Restricted" description="The security incident log is limited to analysts and administrators." />
    );
  }
  const [{ data: incidents }, { data: clients }, { data: zones }] = await Promise.all([
    db.from("cloudflare_incidents").select("*, clients(name), cloudflare_zones(domain), profiles:reported_by(email)").order("incident_date", { ascending: false }),
    db.from("clients").select("id, name").order("name"),
    db.from("cloudflare_zones").select("id, domain").order("domain"),
  ]);
  const zoneOpts = (zones ?? []).map((z) => ({ id: z.id, name: z.domain }));
  return (
    <>
      <Link href="/cloudflare" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" /> Cloudflare Monitor</Link>
      <PageHeader
        title="Security incident log"
        description="Internal record of suspicious administrative activity, unauthorized configuration changes, suspicious redirects, traffic anomalies and investigations. Visible to analysts and administrators only."
      />
      <Card className="mb-4">
        <CardHeader><CardTitle>Record an incident</CardTitle></CardHeader>
        <CardContent><IncidentForm clients={clients ?? []} zones={zoneOpts} /></CardContent>
      </Card>
      {!(incidents ?? []).length ? (
        <EmptyState icon={Siren} title="No incidents recorded" />
      ) : (
        <ul className="flex flex-col gap-3">
          {incidents!.map((i) => (
            <li key={i.id}>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge level={i.severity} />
                    <StatusBadge status={i.status} />
                    <span className="text-sm font-medium">{i.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(i.incident_date)} · {(i.clients as { name: string } | null)?.name}
                      {(i.cloudflare_zones as { domain: string } | null)?.domain ? ` · ${(i.cloudflare_zones as { domain: string }).domain}` : ""}
                      {` · ${i.incident_type.replace(/_/g, " ")}`}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{i.description}</p>
                  {i.resolution_notes && <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground"><span className="text-green-300">Resolution:</span> {i.resolution_notes}</p>}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-primary">Edit</summary>
                    <div className="mt-3"><IncidentForm clients={clients ?? []} zones={zoneOpts} incident={i} /></div>
                  </details>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
