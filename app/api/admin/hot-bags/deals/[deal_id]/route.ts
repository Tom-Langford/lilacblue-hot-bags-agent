import { NextResponse } from "next/server";
import { DraftProductSchema } from "@/src/hotbags/schema";
import { buildCheckMessage } from "@/src/hotbags/checkMessages";
import { getDealSession } from "@/src/platform/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deal_id: string }> }
) {
  const { deal_id } = await params;

  const deal = await getDealSession(deal_id);
  if (!deal) {
    return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
  }

  const check = buildCheckMessage({
    deal_id: deal.deal_id,
    draft_version: deal.draft_version,
    draft: DraftProductSchema.parse(deal.draft_product ?? {}),
  });

  return NextResponse.json({ ok: true, deal, check });
}
