import type { Config } from "@netlify/functions";

/** Calls a protected Next.js route on this site; all logic lives in the app. */
async function callCron(path: string): Promise<Response> {
  const base = process.env.URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error(`[${path}] URL or CRON_SECRET missing; skipping`);
    return new Response("not configured", { status: 200 });
  }
  const res = await fetch(new URL(path, base), {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(28_000),
  }).catch((e: unknown) => {
    console.error(`[${path}] request failed`, e);
    return null;
  });
  const body = res ? await res.text() : "request failed";
  console.log(`[${path}] ${res?.status ?? "ERR"} ${body.slice(0, 500)}`);
  return new Response(null, { status: 200 });
}

const handler = async () => callCron("/api/cron/analyze");
export default handler;

// One pending ingested record per run (newest first), every 5 minutes ≈ 12 per hour.
export const config: Config = { schedule: "*/5 * * * *" };
