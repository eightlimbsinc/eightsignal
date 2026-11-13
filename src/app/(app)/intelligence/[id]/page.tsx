import Link from "next/link";
import { notFound } from "next/navigation";
import { Bookmark, ExternalLink, ShieldAlert } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader, SectionTitle } from "@/components/shared/page";
import { SeverityBadge, StatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { categoryLabel, ITEM_STATUSES, providerName } from "@/lib/intel/taxonomy";
import { formatDate } from "@/lib/utils";
import type { AiAnalysis } from "@/lib/types";
import { isAiConfigured } from "@/lib/ai/analyze";
import { setReadState, toggleBookmark, updateImpactReview, updateItemStatus } from "../actions";
import { AnalyzeButton, DeleteIntelligenceForm, LinkClientForm, NoteForm, TaskFromRecommendation } from "./client-forms";

const CLASSIFICATION_LABEL: Record<string, string> = {
  verified_announcement: "Verified announcement",
  official_documentation: "Official documentation",
  commentary: "Commentary",
  speculation: "Speculation",
  prediction: "Prediction",
  unknown: "Unclassified",
};

export default async function IntelligenceDetail({ params }: PageProps<"/intelligence/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db, user, profile } = await requireMember();
  const editor = canEdit(profile);

  const { data: item } = await db.from("intelligence_items").select("*, sources(name)").eq("id", id).maybeSingle();
  if (!item) notFound();

  const [{ data: analyses }, { data: impacts }, { data: notes }, { data: tasks }, { data: clients }, { data: bm }] = await Promise.all([
    db.from("ai_analyses").select("*").eq("intelligence_id", id).order("analyzed_at", { ascending: false }),
    db.from("client_impacts").select("id, impact_reason, recommended_action, review_status, origin, clients(id, name)").eq("intelligence_id", id),
    db.from("intelligence_notes").select("id, body, created_at, profiles(email, full_name)").eq("intelligence_id", id).order("created_at"),
    db.from("actions").select("id, title, status, priority").eq("intelligence_id", id).order("created_at", { ascending: false }),
    db.from("clients").select("id, name").order("name"),
    db.from("bookmarks").select("id").eq("intelligence_id", id).eq("user_id", user.id).maybeSingle(),
  ]);
  // Opening a record marks it read for this user (idempotent).
  await db.from("read_receipts").upsert({ user_id: user.id, intelligence_id: id }, { ignoreDuplicates: true });

  const current = (analyses ?? []).find((a) => a.is_current) as AiAnalysis | undefined;
  const history = (analyses ?? []).filter((a) => !a.is_current) as AiAnalysis[];
  const aiReady = isAiConfigured();

  return (
    <>
      <PageHeader
        eyebrow={`${providerName(item.provider)} · ${categoryLabel(item.category)}`}
        title={item.title}
        actions={
          <>
            <form action={toggleBookmark}>
              <input type="hidden" name="id" value={id} />
              <Button size="sm" variant="outline" type="submit" aria-pressed={Boolean(bm)}>
                <Bookmark className={bm ? "fill-primary text-primary" : ""} /> {bm ? "Bookmarked" : "Bookmark"}
              </Button>
            </form>
            <form action={setReadState}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="read" value="0" />
              <Button size="sm" variant="ghost" type="submit">Mark unread</Button>
            </form>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardContent className="pt-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Impact</dt><dd className="mt-1"><SeverityBadge level={item.impact_level} /></dd></div>
                <div><dt className="text-muted-foreground">Published</dt><dd className="mt-1">{formatDate(item.published_at)}</dd></div>
                <div><dt className="text-muted-foreground">Discovered</dt><dd className="mt-1">{formatDate(item.discovered_at, true)}</dd></div>
                <div><dt className="text-muted-foreground">Entry</dt><dd className="mt-1 capitalize">{item.entry_method.replace("_", " ")}{item.sources?.name ? ` · ${item.sources.name}` : ""}</dd></div>
              </dl>
              {item.source_url ? (
                <a href={item.source_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-4 inline-flex items-center gap-1 break-all text-xs text-primary hover:underline">
                  <ExternalLink className="size-3.5 shrink-0" /> {item.source_url}
                </a>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">No original source URL (manual entry).</p>
              )}
              {item.summary && <p className="mt-4 text-sm leading-relaxed">{item.summary}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>AI impact analysis</CardTitle>
              {current && (
                <span className="text-[11px] text-muted-foreground">
                  {current.model} · {formatDate(current.analyzed_at, true)}
                </span>
              )}
            </CardHeader>
            <CardContent>
              {item.analysis_status === "failed" && (
                <p role="alert" className="mb-3 rounded-md border border-sev-critical/40 bg-sev-critical/10 px-3 py-2 text-xs text-rose-200">
                  Last analysis failed: {item.analysis_error}
                </p>
              )}
              {!current ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    {item.analysis_status === "running" ? "Analysis is running…" : "Not analysed yet."}
                  </p>
                  {editor && aiReady && <AnalyzeButton id={id} label="Analyse with Claude" />}
                  {!aiReady && <p className="text-xs text-muted-foreground">Configure ANTHROPIC_API_KEY to enable analysis.</p>}
                </div>
              ) : (
                <AnalysisView a={current} />
              )}
              {current && editor && aiReady && (
                <div className="mt-5 border-t pt-4"><AnalyzeButton id={id} label="Re-analyse" /></div>
              )}
            </CardContent>
          </Card>

          {current && current.recommended_actions.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Recommended actions</CardTitle></CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-3">
                  {current.recommended_actions.map((r, i) => (
                    <li key={i} className="rounded-md border px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge level={r.priority} />
                        <Badge variant="secondary">{r.department}</Badge>
                        <span className="text-sm font-medium">{r.title}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
                      {editor && <TaskFromRecommendation intelligenceId={id} rec={r} clients={clients ?? []} />}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {item.raw_content && (
            <Card>
              <CardHeader><CardTitle>Extracted content</CardTitle></CardHeader>
              <CardContent>
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Show raw content ({item.raw_content.length.toLocaleString()} characters, untrusted)</summary>
                  <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{item.raw_content}</pre>
                </details>
              </CardContent>
            </Card>
          )}

          {history.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Analysis history</CardTitle></CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-xs">
                  {history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-2">
                      <SeverityBadge level={h.impact_level} /> <span className="text-muted-foreground">{formatDate(h.analyzed_at, true)} · {h.model} · confidence {Math.round(h.confidence_score * 100)}%</span>
                      <span className="w-full text-muted-foreground">{h.summary}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Status</CardTitle></CardHeader>
            <CardContent>
              {editor ? (
                <form action={updateItemStatus} className="flex gap-2">
                  <input type="hidden" name="id" value={id} />
                  <Select name="status" defaultValue={item.status} aria-label="Status">
                    {ITEM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                  <Button size="default" variant="secondary" type="submit">Save</Button>
                </form>
              ) : (
                <StatusBadge status={item.status} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Affected clients</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!impacts?.length && <p className="text-xs text-muted-foreground">No clients associated.</p>}
              {impacts?.map((im) => {
                const c = im.clients as unknown as { id: string; name: string } | null;
                return (
                  <div key={im.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/clients/${c?.id}`} className="text-sm font-medium hover:text-primary">{c?.name}</Link>
                      <Badge variant="outline">{im.origin === "ai" ? "AI suggested" : im.origin === "rule" ? "Stack match" : "Manual"}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{im.impact_reason}</p>
                    {im.recommended_action && <p className="mt-1 text-xs">→ {im.recommended_action}</p>}
                    {editor ? (
                      <form action={updateImpactReview} className="mt-2 flex gap-2">
                        <input type="hidden" name="id" value={im.id} />
                        <Select name="review_status" defaultValue={im.review_status} className="h-8 text-xs" aria-label="Review status">
                          {["suggested", "confirmed", "in_review", "not_affected", "resolved"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                        </Select>
                        <Button size="sm" variant="secondary" type="submit">Update</Button>
                      </form>
                    ) : (
                      <div className="mt-2"><StatusBadge status={im.review_status} /></div>
                    )}
                  </div>
                );
              })}
              {editor && <LinkClientForm id={id} clients={clients ?? []} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!tasks?.length && <p className="text-xs text-muted-foreground">No tasks yet.</p>}
              {tasks?.map((t) => (
                <Link key={t.id} href={`/actions/${t.id}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted/40">
                  <span className="truncate">{t.title}</span>
                  <StatusBadge status={t.status} />
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Internal notes</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {notes?.map((n) => {
                const p = n.profiles as unknown as { email: string; full_name: string | null } | null;
                return (
                  <div key={n.id} className="text-xs">
                    <div className="text-muted-foreground">{p?.full_name ?? p?.email} · {formatDate(n.created_at, true)}</div>
                    <p className="mt-0.5 whitespace-pre-wrap">{n.body}</p>
                  </div>
                );
              })}
              <NoteForm id={id} />
            </CardContent>
          </Card>

          {profile.role === "admin" && (
            <Card className="border-sev-critical/30">
              <CardHeader><CardTitle className="text-rose-200">Danger zone</CardTitle></CardHeader>
              <CardContent><DeleteIntelligenceForm id={id} fromSource={Boolean(item.source_id)} /></CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function AnalysisView({ a }: { a: AiAnalysis }) {
  const sections: [string, string][] = [
    ["What happened", a.what_happened],
    ["Why it matters", a.why_it_matters],
    ["Risk assessment", a.risk_assessment],
    ["Opportunity assessment", a.opportunity_assessment],
  ];
  const speculative = ["speculation", "prediction", "commentary"].includes(a.source_classification);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge level={a.impact_level} />
        <Badge variant={speculative ? "medium" : "secondary"}>
          {speculative && <ShieldAlert className="size-3" />} {CLASSIFICATION_LABEL[a.source_classification] ?? a.source_classification}
        </Badge>
        <Badge variant="outline">Confidence {Math.round(a.confidence_score * 100)}%</Badge>
        {a.departments.map((d) => <Badge key={d} variant="secondary">{d}</Badge>)}
      </div>
      <p className="text-sm font-medium leading-relaxed">{a.summary}</p>
      {sections.map(([label, body]) => (
        <section key={label}>
          <SectionTitle>{label}</SectionTitle>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{body}</p>
        </section>
      ))}
      <section>
        <SectionTitle>Who is affected</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {a.affected_teams.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
        </div>
      </section>
      <section>
        <SectionTitle>Confidence</SectionTitle>
        <p className="text-xs text-muted-foreground">{a.confidence_rationale}</p>
      </section>
    </div>
  );
}
