import { NextResponse } from "next/server";
import { z } from "zod";
import { buildCheckMessage } from "@/src/hotbags/checkMessages";
import { applyEdits } from "@/src/hotbags/applyEdits";
import { parseOperatorCommand } from "@/src/hotbags/operatorCommands";
import { DraftProductSchema } from "@/src/hotbags/schema";
import { getDealSession, logEvent, updateDealSession } from "@/src/platform/db";

export const runtime = "nodejs";

const ReplySchema = z.object({
  text: z.string().min(1),
});

function buildEvent(args: {
  deal_id: string;
  type: string;
  data: Record<string, unknown>;
}) {
  return {
    event_id: crypto.randomUUID(),
    source: "internal",
    type: args.type,
    occurred_at: new Date().toISOString(),
    correlation_id: args.deal_id,
    shop: null,
    data: args.data,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ deal_id: string }> }
) {
  try {
    const body = ReplySchema.parse(await request.json());
    const { deal_id } = await params;

    const deal = await getDealSession(deal_id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    await logEvent(
      buildEvent({
        deal_id: deal.deal_id,
        type: "dev.operator_reply_received",
        data: { deal_id: deal.deal_id, text: body.text },
      })
    );

    const command = parseOperatorCommand(body.text);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    if (command.intent === "YES") {
      await updateDealSession({
        deal_id: deal.deal_id,
        state: "confirmed",
        expires_at: expiresAt,
      });
      await logEvent(
        buildEvent({
          deal_id: deal.deal_id,
          type: "dev.deal_updated",
          data: { deal_id: deal.deal_id, state: "confirmed" },
        })
      );

      const updated = await getDealSession(deal.deal_id);
      if (!updated) {
        return NextResponse.json({ error: "Deal not found after update" }, { status: 500 });
      }

      return NextResponse.json({ deal: updated, status: "CONFIRMED" });
    } else if (command.intent === "CANCEL") {
      await updateDealSession({
        deal_id: deal.deal_id,
        state: "cancelled",
        expires_at: expiresAt,
      });
      await logEvent(
        buildEvent({
          deal_id: deal.deal_id,
          type: "dev.deal_updated",
          data: { deal_id: deal.deal_id, state: "cancelled" },
        })
      );
    } else if (command.intent === "EDIT") {
      const draft = DraftProductSchema.parse(deal.draft_product ?? {});
      const edited = applyEdits(draft, command.edits);

      if (!edited.ok) {
        return NextResponse.json({ error: edited.error }, { status: 400 });
      }

      await updateDealSession({
        deal_id: deal.deal_id,
        draft_product: edited.draft,
        increment_version: true,
        state: "awaiting_confirmation",
        expires_at: expiresAt,
      });

      await logEvent(
        buildEvent({
          deal_id: deal.deal_id,
          type: "dev.deal_updated",
          data: { deal_id: deal.deal_id, updated: Object.keys(command.edits) },
        })
      );
    }

    const updated = await getDealSession(deal.deal_id);
    if (!updated) {
      return NextResponse.json({ error: "Deal not found after update" }, { status: 500 });
    }

    const check = buildCheckMessage({
      deal_id: updated.deal_id,
      draft_version: updated.draft_version,
      draft: DraftProductSchema.parse(updated.draft_product ?? {}),
    });

    return NextResponse.json({ deal: updated, check });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
