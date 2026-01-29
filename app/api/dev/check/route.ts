import { NextResponse } from "next/server";
import { DraftProductSchema } from "@/src/hotbags/schema";
import { buildCheckMessage } from "@/src/hotbags/checkMessages";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const draft = DraftProductSchema.parse(body);

    const url = new URL(request.url);
    const deal_id = url.searchParams.get("deal_id") ?? "dev";
    const draft_version = Number(url.searchParams.get("draft_version") ?? "1");
    if (!Number.isFinite(draft_version) || draft_version < 1) {
      return NextResponse.json(
        { error: "draft_version must be a positive number" },
        { status: 400 }
      );
    }

    const checkMessage = buildCheckMessage({
      deal_id,
      draft_version,
      draft,
    });

    return NextResponse.json(checkMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
