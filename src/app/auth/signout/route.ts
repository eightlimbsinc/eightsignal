import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const db = await createClient();
  await db.auth.signOut();
  const dest = request.nextUrl.clone();
  dest.pathname = "/login";
  dest.search = "";
  return NextResponse.redirect(dest, { status: 303 });
}
