import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/platform/db";

export const runtime = "nodejs";

export async function GET() {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("automation_events")
    .select("id")
    .limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows_seen: data?.length ?? 0 });
}