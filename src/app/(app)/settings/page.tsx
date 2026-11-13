import { CheckCircle2, XCircle } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { serverEnv } from "@/lib/env";
import { formatDate } from "@/lib/utils";
import { removeAllowedDomain, setUserRole } from "./actions";
import { DomainForm, NameForm, PasswordForm } from "./forms";

export const metadata = { title: "Settings" };

function Flag({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      {ok ? <CheckCircle2 className="mt-0.5 size-3.5 text-green-400" aria-label="configured" /> : <XCircle className="mt-0.5 size-3.5 text-rose-400" aria-label="missing" />}
      <div><div className="font-medium">{label}</div><div className="text-muted-foreground">{hint}</div></div>
    </li>
  );
}

export default async function SettingsPage() {
  const { db, profile } = await requireMember();
  const admin = profile.role === "admin";
  const [{ data: users }, { data: domains }, { data: activity }] = await Promise.all([
    admin ? db.from("profiles").select("id, email, full_name, role, created_at").order("created_at") : Promise.resolve({ data: null }),
    admin ? db.from("allowed_email_domains").select("*").order("domain") : Promise.resolve({ data: null }),
    db.from("activity_logs").select("id, action, entity_type, created_at, metadata, profiles(email)").order("created_at", { ascending: false }).limit(40),
  ]);
  let serviceRole = false;
  try {
    serviceRole = Boolean(serverEnv.supabaseServiceRoleKey());
  } catch {
    serviceRole = false;
  }
  return (
    <>
      <PageHeader title="Settings" description="Access control, configuration status and the administrative audit trail." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Your profile</CardTitle><CardDescription>{profile.email} · {profile.role}</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <NameForm name={profile.full_name ?? ""} />
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Password</div>
              <PasswordForm />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Configuration status</CardTitle><CardDescription>Values are never displayed — only whether they are set.</CardDescription></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              <Flag ok={serviceRole} label="SUPABASE_SERVICE_ROLE_KEY" hint="Scheduled jobs, audits and credential storage" />
              <Flag ok={Boolean(serverEnv.anthropicApiKey())} label="ANTHROPIC_API_KEY" hint={`AI analysis (model ${serverEnv.anthropicModel()}, effort ${serverEnv.anthropicEffort()})`} />
              <Flag ok={Boolean(serverEnv.credentialsKey())} label="CLOUDFLARE_CREDENTIALS_KEY" hint="Encrypting Cloudflare tokens at rest" />
              <Flag ok={Boolean(serverEnv.cronSecret())} label="CRON_SECRET" hint="Netlify scheduled collection & audits" />
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Safety guarantees</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <ul className="list-disc space-y-1 pl-4">
              <li>Cloudflare integration is read-only: no code path writes WAF, redirect, DNS or bot settings.</li>
              <li>No ClickUp tasks or Slack messages are created automatically.</li>
              <li>External content is treated as untrusted data in AI prompts.</li>
              <li>Outbound fetches block private networks and validate redirects.</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {admin && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Team &amp; roles</CardTitle><CardDescription>admin: everything · analyst: create/edit, run audits · viewer: read-only · pending: no access</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <THead><TR className="hover:bg-transparent"><TH>User</TH><TH>Joined</TH><TH>Role</TH></TR></THead>
                <TBody>
                  {users?.map((u) => (
                    <TR key={u.id}>
                      <TD><div className="font-medium">{u.full_name ?? u.email}</div><div className="text-[11px] text-muted-foreground">{u.email}</div></TD>
                      <TD className="text-xs text-muted-foreground">{formatDate(u.created_at)}</TD>
                      <TD>
                        <form action={setUserRole} className="flex gap-1">
                          <input type="hidden" name="id" value={u.id} />
                          <Select name="role" defaultValue={u.role} className="h-8 w-28 text-xs" aria-label={`Role for ${u.email}`}>
                            {["admin", "analyst", "viewer", "pending"].map((r) => <option key={r}>{r}</option>)}
                          </Select>
                          <Button size="sm" variant="ghost" type="submit">Set</Button>
                        </form>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <p className="mt-3 text-[11px] text-muted-foreground">Invite users from the Supabase dashboard (Authentication → Users → Invite). Disable public sign-ups in Supabase Auth settings.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Auto-approved email domains</CardTitle><CardDescription>Invited users from these domains get a role immediately; others wait as pending.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-1 text-xs">
                {domains?.map((d) => (
                  <li key={d.domain} className="flex items-center justify-between rounded-md border px-2.5 py-1.5">
                    <span>@{d.domain} → {d.default_role}</span>
                    <form action={removeAllowedDomain}><input type="hidden" name="domain" value={d.domain} /><Button size="sm" variant="ghost" type="submit" className="h-6">Remove</Button></form>
                  </li>
                ))}
                {!domains?.length && <li className="text-muted-foreground">None — all new users start as pending.</li>}
              </ul>
              <DomainForm />
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="mt-4">
        <CardHeader><CardTitle>{admin ? "Activity log" : "Your activity"}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead><TR className="hover:bg-transparent"><TH>When</TH><TH>User</TH><TH>Action</TH><TH>Entity</TH></TR></THead>
            <TBody>
              {activity?.map((a) => (
                <TR key={a.id}>
                  <TD className="text-xs text-muted-foreground">{formatDate(a.created_at, true)}</TD>
                  <TD className="text-xs">{(a.profiles as unknown as { email: string } | null)?.email ?? "system"}</TD>
                  <TD className="font-mono text-[11px]">{a.action}</TD>
                  <TD className="text-xs text-muted-foreground">{a.entity_type}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
