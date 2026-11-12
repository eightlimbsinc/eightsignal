"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, Building2, ChevronsLeft, ChevronsRight, ListChecks, LayoutDashboard, Menu, Radar,
  Rss, Settings, ShieldCheck, Sparkles, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/intelligence", label: "Intelligence", icon: Radar },
  { href: "/cloudflare", label: "Cloudflare Monitor", icon: ShieldCheck, featured: true },
  { href: "/analysis", label: "Impact Analysis", icon: Sparkles },
  { href: "/actions", label: "Action Center", icon: ListChecks },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/sources", label: "Sources", icon: Rss },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ attentionCount, user }: { attentionCount: number; user: { email: string; role: string } }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted preference after mount
      setCollapsed(localStorage.getItem("es-sidebar-collapsed") === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close the drawer on navigation
    setMobileOpen(false);
  }, [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("es-sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const nav = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              "group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              active && "bg-accent text-foreground",
              item.featured && !active && "text-blue-200",
            )}
          >
            {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded bg-primary" aria-hidden />}
            <Icon className={cn("size-4 shrink-0", item.featured && "text-primary")} aria-hidden />
            <span className={cn("truncate", collapsed && "md:sr-only")}>{item.label}</span>
            {item.featured && attentionCount > 0 && (
              <span
                className={cn(
                  "ml-auto rounded bg-sev-critical/20 px-1.5 text-[10px] font-semibold tabular-nums text-rose-300",
                  collapsed && "md:absolute md:right-1 md:top-1 md:ml-0",
                )}
                aria-label={`${attentionCount} open high or critical Cloudflare findings`}
              >
                {attentionCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-sidebar/95 px-3 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-1.5 hover:bg-accent"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
        >
          <Menu className="size-5" />
        </button>
        <Brand collapsed={false} />
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r bg-sidebar transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "md:w-14" : "md:w-56",
        )}
      >
        <div className="flex h-14 items-center justify-between px-3">
          <Brand collapsed={collapsed} />
          <button type="button" className="rounded-md p-1 hover:bg-accent md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <X className="size-4" />
          </button>
        </div>
        {nav}
        <div className="border-t p-2">
          <div className={cn("mb-1 truncate px-2 text-[11px] text-muted-foreground", collapsed && "md:hidden")}>
            {user.email}
            <span className="ml-1 rounded bg-secondary px-1 capitalize">{user.role}</span>
          </div>
          <form action="/auth/signout" method="post" className={cn(collapsed && "md:hidden")}>
            <button type="submit" className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              Sign out
            </button>
          </form>
          <button
            type="button"
            onClick={toggle}
            className="hidden w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent md:flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            <span className={cn(collapsed && "sr-only")}>Collapse</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Activity className="size-4" aria-hidden />
      </span>
      <span className={cn("text-sm", collapsed && "md:sr-only")}>
        Eight<span className="text-primary">Signal</span>
      </span>
    </Link>
  );
}
