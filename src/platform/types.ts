// src/platform/types.ts

export type EventSource = "whatsapp" | "clawdbot" | "shopify" | "mechanic" | "internal";

export type AutomationEventEnvelope<TData = unknown> = {
  event_id: string;
  source: EventSource;
  type: string; // e.g. "whatsapp.message_received"
  occurred_at: string; // ISO8601
  correlation_id: string; // deal_id for hot bags
  shop: string | null;
  data: TData;
};

export type DealSessionState =
  | "draft"
  | "awaiting_confirmation"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "published";

export type ShopifyActionStatus = "pending" | "success" | "failed";

export type DealSessionRow = {
  id: string;
  deal_id: string;
  correlation_id: string;
  state: DealSessionState;
  operator_id: string | null;
  source_message_ids: unknown; // jsonb array
  draft_product: unknown; // jsonb
  draft_version: number;
  expires_at: string; // ISO
  created_at: string;
  updated_at: string;
};

export type AutomationEventRow = {
  id: string;
  event_id: string;
  source: string;
  type: string;
  correlation_id: string;
  shop: string | null;
  payload: unknown;
  created_at: string;
};

export type ShopifyActionRow = {
  id: string;
  correlation_id: string;
  deal_id: string | null;
  action_type: string;
  shopify_gid: string | null;
  request: unknown;
  response: unknown | null;
  status: ShopifyActionStatus;
  created_at: string;
};

export type AutomationErrorRow = {
  id: string;
  correlation_id: string;
  event_id: string | null;
  service: string;
  error_code: string | null;
  message: string;
  details: unknown | null;
  created_at: string;
};