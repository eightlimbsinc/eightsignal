import Link from "next/link";
import { Bookmark, Plus, Radar } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/shared/page";
import { SeverityBadge, StatusBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { CATEGORIES, IMPACT_LEVELS, ITEM_STATUSES, PROVIDERS, categoryLabel, providerName } from "@/lib/intel/taxonomy";
import { formatDate, truncate } from "@/lib/utils";
import { BulkDeleteUnassessed } from "./bulk-delete";

export const metadata = { title: "Intelligence" };
const PAGE_SIZE = 25;

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

export default async function IntelligencePage({ searchParams }: PageProps<"/intelligence">) {
  const { db, user, profile } = await requireMember();
  const sp = await searchParams;
  const q = str(sp.q).replace(/[%,()*\\]/g, " ").trim().slice(0, 100);
  const provider = str(sp.provider);
  const category = str(sp.category);
  const impact = str(sp.impact);
  const status = str(sp.status);
  const from = str(sp.from);
  const to = str(sp.to);
  const view = str(sp.view); // "bookmarked" | "unread"
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const deleted = str(sp.deleted);

  const isAdmin = profile.role === "admin";
  const [{ data: bookmarks }, { data: receipts }, { data: unassessed }] = await Promise.all([
    db.from("bookmarks").select("intelligence_id").eq("user_id", user.id),
    db.from("read_receipts").select("intelligence_id").eq("user_id", user.id),
    isAdmin
      ? db.from("intelligence_items").select("provider").eq("impact_level", "unassessed").neq("analysis_status", "running").limit(5000)
      : Promise.resolve({ data: [] as { provider: string }[] }),
  ]);
  const unassessedByProvider: Record<string, number> = {};
  for (const r of unassessed ?? []) unassessedByProvider[r.provider] = (unassessedByProvider[r.provider] ?? 0) + 1;
  const bookmarked = new Set((bookmarks ?? []).map((b) => b.intelligence_id));
  const read = new Set((receipts ?? []).map((r) => r.intelligence_id));

  let query = db
    .from("intelligence_items")
    .select("id, title, provider, category, impact_level, status, analysis_status, published_at, discovered_at, summary, source_url, entry_method", { count: "exact" });
  if (q) query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%`);
  if (provider) query = query.eq("provider", provider);
  if (category) query = query.eq("category", category);
  if (impact) query = query.eq("impact_level", impact);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("discovered_at", new Date(from).toISOString());
  if (to) query = query.lte("discovered_at", new Date(`${to}T23:59:59Z`).toISOString());
  if (view === "bookmarked") query = query.in("id", bookmarked.size ? [...bookmarked] : ["00000000-0000-0000-0000-000000000000"]);
  if (view === "unread" && read.size) query = query.not("id", "in", `(${[...read].join(",")})`);
  const { data: items, count, error } = await query
    .order("discovered_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error(error.message);

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const params = new URLSearchParams(Object.entries({ q, provider, category, impact, status, from, to, view }).filter(([, v]) => v) as [string, string][]);
  const pageHref = (p: number) => {
    const n = new URLSearchParams(params);
    n.set("page", String(p));
    return `/intelligence?${n}`;
  };

  return (
    <>
      {deleted && (
        <p role="status" className="mb-4 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-green-200">Deleted “{deleted}”.</p>
      )}
      <PageHeader
        title="Intelligence"
        description="Every tracked development, with its original source, AI impact analysis and status."
        actions={
          canEdit(profile) && (
            <Button asChild size="sm">
              <Link href="/intelligence/new">
                <Plus /> Add intelligence
              </Link>
            </Button>
          )
        }
      />
      {isAdmin && (unassessed?.length ?? 0) > 0 && (
        <BulkDeleteUnassessed counts={{ total: unassessed!.length, byProvider: unassessedByProvider }} />
      )}
      <form className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-9" role="search" aria-label="Filter intelligence">
        <Input name="q" defaultValue={q} placeholder="Search title or summary" className="col-span-2 md:col-span-4 xl:col-span-2" aria-label="Search" />
        <Select name="provider" defaultValue={provider} aria-label="Provider">
          <option value="">All providers</option>
          {PROVIDERS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </Select>
        <Select name="category" defaultValue={category} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </Select>
        <Select name="impact" defaultValue={impact} aria-label="Impact">
          <option value="">All impact</option>
          {[...IMPACT_LEVELS, "unassessed"].map((i) => <option key={i} value={i}>{i}</option>)}
        </Select>
        <Select name="status" defaultValue={status} aria-label="Status">
          <option value="">All statuses</option>
          {ITEM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Input type="date" name="from" defaultValue={from} aria-label="Discovered from" />
        <Input type="date" name="to" defaultValue={to} aria-label="Discovered to" />
        <div className="flex gap-2">
          <Select name="view" defaultValue={view} aria-label="View">
            <option value="">All</option>
            <option value="unread">Unread</option>
            <option value="bookmarked">Bookmarked</option>
          </Select>
          <Button type="submit" size="default" variant="secondary">Filter</Button>
        </div>
      </form>

      {!items?.length ? (
        <EmptyState
          icon={Radar}
          title={params.size ? "No intelligence matches these filters" : "No intelligence yet"}
          description={params.size ? "Try widening the filters." : "Add a record manually, submit a URL, or activate sources to start collecting."}
          action={canEdit(profile) && <Button asChild size="sm"><Link href="/intelligence/new">Add intelligence</Link></Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <ul className="divide-y">
            {items.map((it) => {
              const unread = !read.has(it.id);
              return (
                <li key={it.id} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/30 sm:flex-row sm:items-start sm:gap-4">
                  <div className="flex w-28 shrink-0 items-center gap-2 sm:pt-0.5">
                    <SeverityBadge level={it.impact_level} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/intelligence/${it.id}`} className="flex items-start gap-2 text-sm font-medium hover:text-primary">
                      {unread && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                      <span className={unread ? "" : "text-foreground/80"}>{it.title}</span>
                      {bookmarked.has(it.id) && <Bookmark className="mt-0.5 size-3.5 shrink-0 fill-primary text-primary" aria-label="Bookmarked" />}
                    </Link>
                    {it.summary && <p className="mt-0.5 text-xs text-muted-foreground">{truncate(it.summary, 220)}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="text-foreground/80">{providerName(it.provider)}</span>
                      <span>{categoryLabel(it.category)}</span>
                      <span>Published {formatDate(it.published_at)}</span>
                      <span>Found {formatDate(it.discovered_at)}</span>
                      {it.analysis_status !== "completed" && <StatusBadge status={`analysis ${it.analysis_status}`} />}
                    </div>
                  </div>
                  <div className="shrink-0"><StatusBadge status={it.status} /></div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-xs text-muted-foreground" aria-label="Pagination">
          <span>{total} records · page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Button asChild size="sm" variant="outline"><Link href={pageHref(page - 1)}>Previous</Link></Button>}
            {page < pages && <Button asChild size="sm" variant="outline"><Link href={pageHref(page + 1)}>Next</Link></Button>}
          </div>
        </nav>
      )}
    </>
  );
}
