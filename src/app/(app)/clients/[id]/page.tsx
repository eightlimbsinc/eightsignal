import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader, SectionTitle } from "@/components/shared/page";
import { HealthBadge, SeverityBadge, StatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import type { Client, HealthStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { updateImpactReview } from "../../intelligence/actions";
import { ClientForm } from "../client-form";

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, profile } = await requireMember();
  const editor = canEdit(profile);
  const { data: client } = await db.from("clients").select("*").eq("id", id).maybeSingle();
  if (!client) notFound();
  const [{ data: impacts }, { data: zones }, { data: tasks }] = await Promise.all([
    db.from("client_impacts")
      .select("id, impact_reason, recommended_action, review_status, origin, created_at, owner:profiles!client_impacts_owner_id_fkey(email), intelligence_items(id, title, impact_level, provider, published_at)")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    db.from("cloudflare_zones").select("id, domain, health_status, health_reason, last_audited_at").eq("client_id", id),
    db.from("actions").select("id, title, status, priority, due_date").eq("client_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  const c = client as Client;
  return (
    <>
      <Link href="/clients" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" /> Clients</Link>
      <PageHeader
        title={c.name}
        description={c.website_url ? <a href={c.website_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{c.website_url} <ExternalLink className="size-3" /></a> : undefined}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Relevant intelligence</CardTitle></CardHeader>
            <CardContent>
              {!(impacts ?? []).length ? <p className="text-xs text-muted-foreground">No intelligence mapped to this client yet.</p> : (
                <ul className="flex flex-col gap-2">
                  {impacts!.map((im) => {
                    const it = im.intelligence_items as unknown as { id: string; title: string; impact_level: string; provider: string; published_at: string | null };
                    const owner = im.owner as unknown as { email: string } | null;
                    return (
                      <li key={im.id} className="rounded-md border px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityBadge level={it.impact_level} />
                          <Link href={`/intelligence/${it.id}`} className="text-sm font-medium hover:text-primary">{it.title}</Link>
                          <Badge variant="outline">{im.origin === "ai" ? "AI suggested" : im.origin === "rule" ? "Stack match" : "Manual"}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground"><span className="text-foreground/80">Why:</span> {im.impact_reason}</p>
                        {im.recommended_action && <p className="mt-0.5 text-xs"><span className="text-primary">Action:</span> {im.recommended_action}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {editor ? (
                            <form action={updateImpactReview} className="flex gap-1">
                              <input type="hidden" name="id" value={im.id} />
                              <Select name="review_status" defaultValue={im.review_status} className="h-7 w-36 text-xs" aria-label="Review status">
                                {["suggested", "confirmed", "in_review", "not_affected", "resolved"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                              </Select>
                              <Button size="sm" variant="ghost" className="h-7" type="submit">Update</Button>
                            </form>
                          ) : <StatusBadge status={im.review_status} />}
                          <span>Owner: {owner?.email ?? "unassigned"}</span>
                          <span>Mapped {formatDate(im.created_at)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          {editor && (
            <Card>
              <CardHeader><CardTitle>Client profile &amp; technology stack</CardTitle></CardHeader>
              <CardContent><ClientForm client={c} /></CardContent>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Stack</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-xs">
              <dl className="grid grid-cols-2 gap-2">
                <dt className="text-muted-foreground">CMS</dt><dd>{c.platform ?? "—"}</dd>
                <dt className="text-muted-foreground">Hosting</dt><dd>{c.hosting_provider ?? "—"}</dd>
                <dt className="text-muted-foreground">CDN</dt><dd>{c.cdn_provider ?? "—"}</dd>
              </dl>
              <div><SectionTitle>Technologies</SectionTitle><div className="flex flex-wrap gap-1">{c.technology_stack.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}</div></div>
              <div><SectionTitle>Services</SectionTitle><div className="flex flex-wrap gap-1">{c.active_services.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</div></div>
              {c.notes && <div><SectionTitle>Notes</SectionTitle><p className="whitespace-pre-wrap text-muted-foreground">{c.notes}</p></div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Cloudflare zones</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!(zones ?? []).length && <p className="text-xs text-muted-foreground">None registered.</p>}
              {zones?.map((z) => (
                <Link key={z.id} href={`/cloudflare/zones/${z.id}`} className="rounded-md border px-3 py-2 text-xs hover:bg-muted/40">
                  <div className="flex items-center justify-between"><span className="font-medium">{z.domain}</span><HealthBadge status={z.health_status as HealthStatus} /></div>
                  <div className="mt-1 text-muted-foreground">{z.health_reason}</div>
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!(tasks ?? []).length && <p className="text-xs text-muted-foreground">No tasks.</p>}
              {tasks?.map((t) => (
                <Link key={t.id} href={`/actions/${t.id}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted/40">
                  <span className="truncate">{t.title}</span><StatusBadge status={t.status} />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
