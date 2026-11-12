import Link from "next/link";
import { Building2 } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/shared/page";
import { HealthBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { Client, HealthStatus } from "@/lib/types";
import { ClientForm } from "./client-form";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const { db, profile } = await requireMember();
  const [{ data: clients }, { data: impacts }, { data: zones }, { data: actions }] = await Promise.all([
    db.from("clients").select("*").order("name"),
    db.from("client_impacts").select("client_id, review_status"),
    db.from("cloudflare_zones").select("client_id, health_status"),
    db.from("actions").select("client_id, status").in("status", ["open", "in_progress", "in_review"]),
  ]);
  return (
    <>
      <PageHeader title="Clients" description="Client registry and manually recorded technology stacks, used to map intelligence to affected clients. No automatic infrastructure discovery is performed." />
      {!(clients ?? []).length ? (
        <EmptyState icon={Building2} title="No clients registered" description="Register Blend360 first to enable Cloudflare monitoring." />
      ) : (
        <Card>
          <Table>
            <THead><TR className="hover:bg-transparent"><TH>Client</TH><TH>Stack</TH><TH>Services</TH><TH>Cloudflare</TH><TH>Open impacts</TH><TH>Open tasks</TH></TR></THead>
            <TBody>
              {(clients as Client[]).map((c) => {
                const zone = zones?.find((z) => z.client_id === c.id);
                return (
                  <TR key={c.id}>
                    <TD><Link href={`/clients/${c.id}`} className="font-medium hover:text-primary">{c.name}</Link><div className="text-[11px] text-muted-foreground">{c.industry}</div></TD>
                    <TD><div className="flex max-w-72 flex-wrap gap-1">{[c.cdn_provider, c.hosting_provider, c.platform, ...c.technology_stack].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6).map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}</div></TD>
                    <TD className="max-w-60 text-xs text-muted-foreground">{c.active_services.join(", ") || "—"}</TD>
                    <TD>{zone ? <HealthBadge status={zone.health_status as HealthStatus} /> : <span className="text-xs text-muted-foreground">—</span>}</TD>
                    <TD className="tabular-nums">{(impacts ?? []).filter((i) => i.client_id === c.id && !["not_affected", "resolved"].includes(i.review_status)).length}</TD>
                    <TD className="tabular-nums">{(actions ?? []).filter((a) => a.client_id === c.id).length}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
      {canEdit(profile) && (
        <Card className="mt-5">
          <CardHeader><CardTitle>Register client</CardTitle></CardHeader>
          <CardContent><ClientForm /></CardContent>
        </Card>
      )}
    </>
  );
}
