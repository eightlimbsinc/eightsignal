import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const metadata = { title: "Access pending" };

export default async function PendingPage() {
  const { user, profile } = await getSession();
  if (!user) redirect("/login");
  if (profile && profile.role !== "pending") redirect("/");
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm rounded-lg border bg-card p-6">
        <h1 className="text-base font-semibold">Access pending</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You are signed in as <span className="text-foreground">{user.email}</span>, but an administrator has not yet
          approved your account. EightSignal contains internal security records, so access is granted manually.
        </p>
        <form action="/auth/signout" method="post" className="mt-4">
          <button className="text-xs text-primary underline-offset-2 hover:underline" type="submit">Sign out</button>
        </form>
      </div>
    </div>
  );
}
