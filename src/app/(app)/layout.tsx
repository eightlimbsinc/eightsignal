import { Sidebar } from "@/components/layout/sidebar";
import { requireMember } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, profile } = await requireMember();
  const { count } = await db
    .from("cloudflare_findings")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "acknowledged"])
    .in("severity", ["critical", "high"]);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar attentionCount={count ?? 0} user={{ email: profile.email, role: profile.role }} />
      <main className="min-w-0 flex-1 px-4 py-5 md:px-7 md:py-6">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
