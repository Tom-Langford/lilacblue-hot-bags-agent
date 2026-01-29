import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/platform/db";
import { DraftProductSchema } from "@/src/hotbags/schema";
import { buildDeterministicTitle } from "@/src/hotbags/checkMessages";

export const runtime = "nodejs";

function parseLimit(request: Request): number | Response {
  const url = new URL(request.url);
  const raw = url.searchParams.get("limit");
  if (!raw) return 50;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return NextResponse.json({ ok: false, error: "limit must be a positive integer" }, { status: 400 });
  }

  return Math.min(parsed, 200);
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function deriveTitle(draft_product: unknown): string {
  const parsed = DraftProductSchema.safeParse(draft_product);
  if (parsed.success) {
    return buildDeterministicTitle(parsed.data);
  }

  const draft = (draft_product ?? {}) as Record<string, any>;
  const brand = pickString(draft.brand) ?? "Hermès";
  const style = pickString(draft?.bag_style?.value);
  const size = Number.isFinite(draft?.bag_size_cm?.value) ? `${draft.bag_size_cm.value}cm` : null;
  const colour = pickString(draft?.hermes_colour?.value?.label);
  const material = pickString(draft?.hermes_material?.value?.label);
  const hardware = pickString(draft?.hermes_hardware?.value?.label);

  const parts = [style, size, colour, material, hardware].filter(Boolean);
  return parts.length ? `${brand} ${parts.join(" ")}` : `${brand} deal`;
}

export async function GET(request: Request) {
  const limit = parseLimit(request);
  if (limit instanceof Response) return limit;

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_sessions")
    .select("deal_id,state,draft_version,updated_at,expires_at,draft_product")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const deals =
    data?.map((deal) => ({
      deal_id: deal.deal_id,
      state: deal.state,
      draft_version: deal.draft_version,
      updated_at: deal.updated_at,
      expires_at: deal.expires_at,
      title: deriveTitle(deal.draft_product),
    })) ?? [];

  return NextResponse.json({ ok: true, deals });
}
