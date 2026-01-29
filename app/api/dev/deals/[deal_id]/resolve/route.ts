import { NextResponse } from "next/server";
import { DraftProductSchema } from "@/src/hotbags/schema";
import { resolveMetaobject } from "@/src/hotbags/resolveMetaobjects";
import { getDealSession, logError, logEvent, updateDealSession } from "@/src/platform/db";
import type { AutomationEventEnvelope } from "@/src/platform/types";

export const runtime = "nodejs";

function buildEvent(args: {
  type: string;
  correlation_id: string;
  data: Record<string, unknown>;
}): AutomationEventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    source: "internal",
    type: args.type,
    occurred_at: new Date().toISOString(),
    correlation_id: args.correlation_id,
    shop: null,
    data: args.data,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ deal_id: string }> }
) {
  try {
    const { deal_id } = await params;
    if (!deal_id) {
      return NextResponse.json({ error: "Missing deal_id param" }, { status: 400 });
    }

    const deal = await getDealSession(deal_id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found", deal_id }, { status: 404 });
    }

    if (deal.state !== "confirmed") {
      return NextResponse.json(
        { error: "Deal must be confirmed before resolution", state: deal.state },
        { status: 400 }
      );
    }

    await logEvent(
      buildEvent({
        type: "dev.metaobject_resolve_attempt",
        correlation_id: deal.deal_id,
        data: { deal_id: deal.deal_id },
      })
    );

    const draft = DraftProductSchema.parse(deal.draft_product ?? {});
    const shop = process.env.SHOPIFY_SHOP;
    if (!shop) {
      return NextResponse.json({ error: "Missing SHOPIFY_SHOP env var" }, { status: 500 });
    }

    const [colour, material, hardware, construction] = await Promise.all([
      resolveMetaobject({
        shop,
        type_handle: "hermes_colour",
        label: draft.hermes_colour.value.label,
      }),
      resolveMetaobject({
        shop,
        type_handle: "herm_s_material",
        label: draft.hermes_material.value.label,
      }),
      resolveMetaobject({
        shop,
        type_handle: "hermes_hardware",
        label: draft.hermes_hardware.value.label,
      }),
      resolveMetaobject({
        shop,
        type_handle: "hermes_construction",
        label: draft.hermes_construction.value.label,
      }),
    ]);

    draft.hermes_colour.value.id = colour.id;
    draft.hermes_material.value.id = material.id;
    draft.hermes_hardware.value.id = hardware.id;
    draft.hermes_construction.value.id = construction.id;

    await updateDealSession({
      deal_id: deal.deal_id,
      draft_product: draft,
      increment_version: true,
    });

    await logEvent(
      buildEvent({
        type: "dev.metaobject_resolve_success",
        correlation_id: deal.deal_id,
        data: {
          deal_id: deal.deal_id,
          resolved: {
            hermes_colour: colour,
            hermes_material: material,
            hermes_hardware: hardware,
            hermes_construction: construction,
          },
        },
      })
    );

    const updated = await getDealSession(deal.deal_id);
    if (!updated) {
      return NextResponse.json({ error: "Deal not found after update" }, { status: 500 });
    }

    return NextResponse.json({ deal: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve metaobjects";
    const errorId = crypto.randomUUID();
    await logError({
      correlation_id: "dev.metaobject_resolve",
      service: "ops-console",
      error_code: "resolve_metaobjects_failed",
      message,
      details: { error_id: errorId, stack: error instanceof Error ? error.stack : error },
    });
    await logEvent(
      buildEvent({
        type: "dev.metaobject_resolve_failure",
        correlation_id: "dev.metaobject_resolve",
        data: { error: message, error_id: errorId },
      })
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
