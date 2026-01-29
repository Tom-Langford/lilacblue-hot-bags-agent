import { NextResponse } from "next/server";
import { DraftProductSchema } from "@/src/hotbags/schema";
import { ResolveMetaobjectError, resolveMetaobjectStrict } from "@/src/hotbags/resolveMetaobjects";
import { getDealSession, logError, logEvent, updateDealSession } from "@/src/platform/db";
import type { AutomationEventEnvelope } from "@/src/platform/types";

export const runtime = "nodejs";

class HttpError extends Error {
  status: number;
  payload: Record<string, unknown>;
  correlationId?: string;

  constructor(status: number, payload: Record<string, unknown>, correlationId?: string) {
    super(payload.error ? String(payload.error) : "Request failed");
    this.status = status;
    this.payload = payload;
    this.correlationId = correlationId;
  }
}

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
  _request: Request,
  { params }: { params: Promise<{ deal_id: string }> }
) {
  const { deal_id } = await params;
  const service = "admin.hot-bags";

  try {
    const deal = await getDealSession(deal_id);
    if (!deal) {
      throw new HttpError(404, { ok: false, error: "Deal not found" }, deal_id);
    }

    if (deal.state !== "confirmed") {
      throw new HttpError(
        400,
        { ok: false, error: "Deal must be confirmed before metaobject resolution", state: deal.state },
        deal.deal_id
      );
    }

    await logEvent(
      buildEvent({
        type: "admin.metaobject_resolve_attempt",
        correlation_id: deal.deal_id,
        data: { deal_id: deal.deal_id },
      })
    );

    const draft = DraftProductSchema.parse(deal.draft_product ?? {});
    const shop = process.env.SHOPIFY_SHOP;
    if (!shop) {
      throw new HttpError(500, { ok: false, error: "Missing SHOPIFY_SHOP env var" }, deal.deal_id);
    }

    const resolveField = async (field: string, type_handle: string, label: string) => {
      try {
        return await resolveMetaobjectStrict({ shop, type_handle, label });
      } catch (error) {
        if (error instanceof ResolveMetaobjectError) {
          if (error.code === "not_found") {
            throw new HttpError(
              400,
              { ok: false, error: "Unresolved metaobject", field, label },
              deal.deal_id
            );
          }
          if (error.code === "ambiguous") {
            throw new HttpError(
              409,
              {
                ok: false,
                error: "Ambiguous metaobject match",
                field,
                label,
                candidates: error.candidates ?? [],
              },
              deal.deal_id
            );
          }
        }
        throw error;
      }
    };

    const colour = await resolveField(
      "hermes_colour",
      "hermes_colour",
      draft.hermes_colour.value.label
    );
    const material = await resolveField(
      "hermes_material",
      "her_s_material",
      draft.hermes_material.value.label
    );
    const hardware = await resolveField(
      "hermes_hardware",
      "hermes_hardware",
      draft.hermes_hardware.value.label
    );
    const construction = await resolveField(
      "hermes_construction",
      "hermes_construction",
      draft.hermes_construction.value.label
    );

    draft.hermes_colour.value = { label: draft.hermes_colour.value.label, id: colour.id };
    draft.hermes_material.value = { label: draft.hermes_material.value.label, id: material.id };
    draft.hermes_hardware.value = { label: draft.hermes_hardware.value.label, id: hardware.id };
    draft.hermes_construction.value = {
      label: draft.hermes_construction.value.label,
      id: construction.id,
    };

    const updatedAt = new Date().toISOString();
    await updateDealSession({
      deal_id: deal.deal_id,
      draft_product: draft,
      increment_version: true,
      updated_at: updatedAt,
    });

    const updated = await getDealSession(deal.deal_id);
    if (!updated) {
      throw new HttpError(500, { ok: false, error: "Deal not found after update" }, deal.deal_id);
    }

    const resolved = {
      hermes_colour: {
        label: colour.label,
        id: colour.id,
        display_name: colour.displayName,
      },
      hermes_material: {
        label: material.label,
        id: material.id,
        display_name: material.displayName,
      },
      hermes_hardware: {
        label: hardware.label,
        id: hardware.id,
        display_name: hardware.displayName,
      },
      hermes_construction: {
        label: construction.label,
        id: construction.id,
        display_name: construction.displayName,
      },
    };

    await logEvent(
      buildEvent({
        type: "admin.metaobject_resolve_success",
        correlation_id: deal.deal_id,
        data: { deal_id: deal.deal_id, resolved },
      })
    );

    return NextResponse.json({ ok: true, deal: updated, resolved });
  } catch (error) {
    if (error instanceof HttpError) {
      await logError({
        correlation_id: error.correlationId ?? deal_id,
        service,
        error_code: "resolve_metaobjects_failed",
        message: error.message,
        details: error.payload,
      });
      await logEvent(
        buildEvent({
          type: "admin.metaobject_resolve_failure",
          correlation_id: error.correlationId ?? deal_id,
          data: { error: error.message, details: error.payload },
        })
      );
      return NextResponse.json(error.payload, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to resolve metaobjects";
    await logError({
      correlation_id: deal_id,
      service,
      error_code: "resolve_metaobjects_failed",
      message,
      details: { error },
    });
    await logEvent(
      buildEvent({
        type: "admin.metaobject_resolve_failure",
        correlation_id: deal_id,
        data: { error: message },
      })
    );
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
