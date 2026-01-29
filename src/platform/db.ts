// src/platform/db.ts

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  AutomationEventEnvelope,
  DealSessionState,
  ShopifyActionStatus,
} from "./types";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Server-only client (service role)
let _client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_client) return _client;

  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY"); // server only
  _client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return _client;
}

/**
 * Idempotent event log: inserts once per event_id.
 * If the event already exists, it does nothing.
 */
export async function logEvent(envelope: AutomationEventEnvelope): Promise<void> {
  const sb = supabaseAdmin();

  const row = {
    event_id: envelope.event_id,
    source: envelope.source,
    type: envelope.type,
    correlation_id: envelope.correlation_id,
    shop: envelope.shop,
    payload: envelope,
  };

  // Upsert on unique(event_id)
  const { error } = await sb
    .from("automation_events")
    .upsert(row, { onConflict: "event_id", ignoreDuplicates: true });

  if (error) throw error;
}

export async function logError(args: {
  correlation_id: string;
  event_id?: string | null;
  service: string;
  error_code?: string | null;
  message: string;
  details?: unknown;
}): Promise<void> {
  const sb = supabaseAdmin();

  const { error } = await sb.from("automation_errors").insert({
    correlation_id: args.correlation_id,
    event_id: args.event_id ?? null,
    service: args.service,
    error_code: args.error_code ?? null,
    message: args.message,
    details: args.details ?? null,
  });

  if (error) throw error;
}

export async function createDealSession(args: {
  deal_id: string;
  correlation_id: string;
  operator_id?: string | null;
  source_message_ids?: string[];
  draft_product?: unknown;
  expires_at: string; // ISO
}): Promise<void> {
  const sb = supabaseAdmin();

  const { error } = await sb.from("deal_sessions").insert({
    deal_id: args.deal_id,
    correlation_id: args.correlation_id,
    state: "draft",
    operator_id: args.operator_id ?? null,
    source_message_ids: args.source_message_ids ?? [],
    draft_product: args.draft_product ?? {},
    draft_version: 1,
    expires_at: args.expires_at,
  });

  if (error) throw error;
}

export async function getDealSessionByDealId(deal_id: string) {
  return getDealSession(deal_id);
}

export async function getDealSession(deal_id: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_sessions")
    .select("*")
    .eq("deal_id", deal_id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listDealSessions(limit = 50) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_sessions")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function getMetaobjectFromCache(args: {
  shop: string;
  type_handle: string;
  normalized_label: string;
}) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("metaobject_cache")
    .select("*")
    .eq("shop", args.shop)
    .eq("type_handle", args.type_handle)
    .eq("normalized_label", args.normalized_label)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function upsertMetaobjectCache(args: {
  shop: string;
  type_handle: string;
  input_label: string;
  normalized_label: string;
  gid: string;
  displayName: string;
}) {
  const sb = supabaseAdmin();

  const { error } = await sb.from("metaobject_cache").upsert(
    {
      shop: args.shop,
      type_handle: args.type_handle,
      input_label: args.input_label,
      normalized_label: args.normalized_label,
      gid: args.gid,
      display_name: args.displayName,
    },
    { onConflict: "shop,type_handle,normalized_label" }
  );

  if (error) throw error;
}

export async function updateDealSession(args: {
  deal_id: string;
  state?: DealSessionState;
  operator_id?: string | null;
  source_message_ids?: string[];
  draft_product?: unknown;
  increment_version?: boolean;
  expires_at?: string;
}): Promise<void> {
  const sb = supabaseAdmin();

  const patch: Record<string, unknown> = {};
  if (args.state) patch.state = args.state;
  if (args.operator_id !== undefined) patch.operator_id = args.operator_id;
  if (args.source_message_ids) patch.source_message_ids = args.source_message_ids;
  if (args.draft_product !== undefined) patch.draft_product = args.draft_product;
  if (args.expires_at) patch.expires_at = args.expires_at;

  if (args.increment_version) {
    // Atomic increment
    const { error } = await sb.rpc("increment_draft_version_and_patch", {
      p_deal_id: args.deal_id,
      p_patch: patch,
    });

    if (error) throw error;
    return;
  }

  const { error } = await sb.from("deal_sessions").update(patch).eq("deal_id", args.deal_id);
  if (error) throw error;
}

/**
 * Logs every Shopify mutation attempt
 */
export async function appendShopifyAction(args: {
  correlation_id: string;
  deal_id?: string | null;
  action_type: string;
  shopify_gid?: string | null;
  request: unknown;
  response?: unknown | null;
  status: ShopifyActionStatus;
}): Promise<void> {
  const sb = supabaseAdmin();

  const { error } = await sb.from("shopify_actions").insert({
    correlation_id: args.correlation_id,
    deal_id: args.deal_id ?? null,
    action_type: args.action_type,
    shopify_gid: args.shopify_gid ?? null,
    request: args.request,
    response: args.response ?? null,
    status: args.status,
  });

  if (error) throw error;
}