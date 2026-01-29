import { NextResponse } from "next/server";
import { getDealSession } from "@/src/platform/db";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ deal_id: string }> }
) {
  const { deal_id } = await params;

  const deal = await getDealSession(deal_id);
  if (!deal) {
    return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
  }

  if (deal.state !== "confirmed") {
    return NextResponse.json(
      { ok: false, error: `Deal must be confirmed to resolve metaobjects (state=${deal.state})` },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, deal_id: deal.deal_id, message: "stub" });
}
