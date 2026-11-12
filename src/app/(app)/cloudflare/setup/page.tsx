import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMember, canEdit } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import { removeCredential } from "../actions";
import { AccountForm, CredentialForm, ZoneForm } from "./forms";

export const metadata = { title: "Cloudflare setup" };

const REQUIRED_SCOPES = [
  ["Zone → Zone → Read", "Zone details and zone ID lookup"],
  ["Zone → Zone WAF → Read", "WAF custom rules (http_request_firewall_custom)"],
  ["Zone → Single Redirect / Dynamic Redirect → Read", "Redirect rules (http_request_dynamic_redirect)"],
  ["Zone → Page Rules → Read", "Legacy forwarding URLs (optional)"],
  ["Zone → Bot Management → Read", "Bot settings incl. AI-bot blocking (plan-dependent)"],
  ["Zone → Analytics → Read", "Security events via GraphQL Analytics (optional)"],
  ["Account → Account Settings / Audit Logs → Read", "Configuration change history (optional)"],
];

export default async function SetupPage() {
  const { db, profile } = await requireMember();
  if (!canEdit(profile)) redirect("/cloudflare");
  const [{ data: clients }, { data: accounts }] = await Promise.all([
    db.from("clients").select("id, name").order("name"),
    db.from("cloudflare_accounts").select("id, client_id, account_name, account_identifier, connection_status, connection_checked_at, connection_error, clients(name)").order("account_name"),
  ]);
  // Token hints only (never the token) — read with the service role, after the role check above.
  let hints = new Map<string, { storage: string; token_hint: string | null; env_var_name: string | null; rotated_at: string | null }>();
  if (profile.role === "admin") {
    const { data } = await createAdminClient().from("cloudflare_credentials").select("cloudflare_account_id, storage, token_hint, env_var_name, rotated_at");
    hints = new Map((data ?? []).map((d) => [d.cloudflare_account_id, d]));
  }
  const clientOpts = (clients ?? []).map((c) => ({ id: c.id, name: c.name }));
  const accountOpts = (accounts ?? []).map((a) => ({ id: a.id, name: `${a.account_name} (${(a.clients as unknown as { name: string } | null)?.name ?? ""})`, client_id: a.client_id }));

  return (
    <>
      <Link href="/cloudflare" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" /> Cloudflare Monitor</Link>
      <PageHeader title="Connect Cloudflare" description="Register client accounts, store scoped read-only API tokens and register zones. Tokens never reach the browser." />
      {!clientOpts.length && (
        <p className="mb-4 rounded-md border border-sev-medium/40 bg-sev-medium/10 px-3 py-2 text-xs text-yellow-100">
          Register a client first in <Link href="/clients" className="underline">Clients</Link>.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>1. Register account</CardTitle><CardDescription>One per Cloudflare account you have delegated access to.</CardDescription></CardHeader>
          <CardContent><AccountForm clients={clientOpts} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>2. Add scoped API token</CardTitle><CardDescription>Administrators only. Create a custom token with read permissions only.</CardDescription></CardHeader>
          <CardContent>
            {profile.role === "admin" ? <CredentialForm accounts={accountOpts} /> : <p className="text-xs text-muted-foreground">Ask an administrator to add the token.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>3. Register zone</CardTitle><CardDescription>Default monitored URLs (homepage, robots.txt, sitemap) are added automatically.</CardDescription></CardHeader>
          <CardContent><ZoneForm clients={clientOpts} accounts={accountOpts} /></CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Registered accounts</CardTitle></CardHeader>
        <CardContent>
          {!(accounts ?? []).length ? <p className="text-xs text-muted-foreground">None yet.</p> : (
            <Table>
              <THead><TR className="hover:bg-transparent"><TH>Account</TH><TH>Client</TH><TH>Status</TH><TH>Token</TH><TH>Checked</TH><TH /></TR></THead>
              <TBody>
                {accounts!.map((a) => {
                  const h = hints.get(a.id);
                  return (
                    <TR key={a.id}>
                      <TD><div className="font-medium">{a.account_name}</div><code className="text-[10px] text-muted-foreground">{a.account_identifier ?? "no account ID"}</code></TD>
                      <TD className="text-muted-foreground">{(a.clients as unknown as { name: string } | null)?.name}</TD>
                      <TD><StatusBadge status={a.connection_status} />{a.connection_error && <div className="mt-1 max-w-64 text-[11px] text-rose-300">{a.connection_error}</div>}</TD>
                      <TD className="text-xs text-muted-foreground">{profile.role !== "admin" ? "hidden" : h ? (h.storage === "env" ? `env: ${h.env_var_name}` : `encrypted …${h.token_hint}`) : "none"}</TD>
                      <TD className="text-xs text-muted-foreground">{formatDate(a.connection_checked_at, true)}</TD>
                      <TD>
                        {profile.role === "admin" && h && (
                          <form action={removeCredential}><input type="hidden" name="account_id" value={a.id} /><Button size="sm" variant="ghost" type="submit">Remove token</Button></form>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Minimum token permissions</CardTitle>
          <CardDescription>
            Use a custom API token restricted to the client&apos;s zone(s) with only these <strong>Read</strong> permissions. Never use a Global API Key.
            Permission names follow the Cloudflare dashboard and may change — any capability a token lacks is reported as &quot;unavailable&quot; rather than failing the audit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
            {REQUIRED_SCOPES.map(([scope, why]) => (
              <li key={scope} className="rounded-md border px-2.5 py-1.5"><div className="font-medium">{scope}</div><div className="text-muted-foreground">{why}</div></li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Not read via API (manual verification): per-crawler settings in AI Crawl Control and any setting the token cannot read. Record verified values in each zone&apos;s AI access matrix.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
