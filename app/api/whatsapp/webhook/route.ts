import { NextResponse } from "next/server";
import crypto from "crypto";
import { buildCheckMessage } from "@/src/hotbags/checkMessages";
import {
  BagStyleEnum,
  CurrencyEnum,
  DraftProductSchema,
  type DraftProduct,
} from "@/src/hotbags/schema";
import { createDealSession, getDealSession, logError, logEvent, updateDealSession } from "@/src/platform/db";
import type { AutomationEventEnvelope } from "@/src/platform/types";

export const runtime = "nodejs";

type ExtractedMessage = {
  message_id: string;
  from: string;
  timestamp: string;
  type: string;
  text_body: string | null;
  image_id: string | null;
  raw_message: Record<string, unknown>;
  raw_value: Record<string, unknown>;
};

function buildEvent(args: {
  correlation_id: string;
  data: Record<string, unknown>;
}): AutomationEventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    source: "whatsapp",
    type: "whatsapp.message",
    occurred_at: new Date().toISOString(),
    correlation_id: args.correlation_id,
    shop: null,
    data: args.data,
  };
}

function toIsoFromSeconds(seconds: string): string {
  const parsed = Number.parseInt(seconds, 10);
  if (!Number.isFinite(parsed)) return new Date().toISOString();
  return new Date(parsed * 1000).toISOString();
}

function buildCorrelationId(from: string, messageId: string): string {
  return `wa_${from}_${messageId}`;
}

function extractMessageValues(payload: unknown): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];

  if (payload && typeof payload === "object" && "entry" in payload) {
    const entry = (payload as { entry?: unknown }).entry;
    if (Array.isArray(entry)) {
      for (const item of entry) {
        const changes = (item as { changes?: unknown }).changes;
        if (Array.isArray(changes)) {
          for (const change of changes) {
            const value = (change as { value?: unknown }).value;
            if (value && typeof value === "object") {
              values.push(value as Record<string, unknown>);
            }
          }
        }
      }
      return values;
    }
  }

  if (payload && typeof payload === "object") {
    const field = (payload as { field?: unknown }).field;
    const value = (payload as { value?: unknown }).value;
    if (field === "messages" && value && typeof value === "object") {
      return [value as Record<string, unknown>];
    }
  }

  return values;
}

function extractMessages(payload: unknown): ExtractedMessage[] {
  const values = extractMessageValues(payload);
  const messages: ExtractedMessage[] = [];

  for (const value of values) {
    const list = Array.isArray(value.messages) ? value.messages : [];
    for (const rawMessage of list) {
      if (!rawMessage || typeof rawMessage !== "object") continue;
      const message = rawMessage as Record<string, unknown>;
      const message_id = typeof message.id === "string" ? message.id : "";
      const from = typeof message.from === "string" ? message.from : "";
      const timestamp = typeof message.timestamp === "string" ? message.timestamp : "";
      const type = typeof message.type === "string" ? message.type : "";
      if (!message_id || !from || !timestamp || !type) continue;

      const text_body =
        type === "text" && typeof (message.text as { body?: unknown } | undefined)?.body === "string"
          ? (message.text as { body: string }).body
          : null;
      const image_id =
        type === "image" && typeof (message.image as { id?: unknown } | undefined)?.id === "string"
          ? (message.image as { id: string }).id
          : null;

      messages.push({
        message_id,
        from,
        timestamp,
        type,
        text_body,
        image_id,
        raw_message: message,
        raw_value: value,
      });
    }
  }

  return messages;
}

function buildStubDraft(source_text: string, source_message_id: string, source_chat_id: string): DraftProduct {
  const base: DraftProduct = {
    brand: "Hermès",
    bag_style: {
      value: "Hermès Birkin",
      confidence: "medium",
      source: "deterministic",
    },
    bag_size_cm: {
      value: 25,
      confidence: "medium",
      source: "deterministic",
    },
    hermes_colour: {
      value: { label: "Gold" },
      confidence: "medium",
      source: "deterministic",
    },
    hermes_material: {
      value: { label: "Togo" },
      confidence: "medium",
      source: "deterministic",
    },
    hermes_hardware: {
      value: { label: "Gold" },
      confidence: "medium",
      source: "deterministic",
    },
    hermes_construction: {
      value: { label: "Sellier" },
      confidence: "low",
      source: "deterministic",
    },
    dimensions: {
      value: { length_cm: 25, width_cm: 12, height_cm: 20 },
      confidence: "low",
      source: "deterministic",
    },
    stamp: { value: "", confidence: "unknown", source: "deterministic" },
    condition: { value: "Excellent", confidence: "medium", source: "deterministic" },
    price: { value: 18000, confidence: "low", source: "deterministic" },
    currency: { value: "GBP", confidence: "high", source: "deterministic" },
    receipt: { value: "", confidence: "unknown", source: "deterministic" },
    accessories: { value: "", confidence: "unknown", source: "deterministic" },
    notes: { value: "", confidence: "unknown", source: "deterministic" },
    image_status: "reseller",
    provenance: { source_text, source_message_id, source_chat_id },
  };

  const extracted = extractFromSourceText(source_text);

  if (extracted.bag_style) {
    base.bag_style.value = extracted.bag_style;
    base.bag_style.confidence = "high";
  }

  if (extracted.bag_size_cm) {
    base.bag_size_cm.value = extracted.bag_size_cm;
    base.bag_size_cm.confidence = "high";
  }

  if (extracted.currency) {
    base.currency.value = extracted.currency;
    base.currency.confidence = "high";
  }

  if (extracted.price) {
    base.price.value = extracted.price;
    base.price.confidence = "high";
  }

  if (extracted.receipt !== null) {
    base.receipt.value = extracted.receipt ? "Provided" : "Not provided";
    base.receipt.confidence = "high";
  }

  if (extracted.stamp) {
    base.stamp.value = extracted.stamp;
    base.stamp.confidence = "high";
  }

  return base;
}

function extractFromSourceText(source_text: string) {
  const text = source_text.toLowerCase();

  let bag_style: DraftProduct["bag_style"]["value"] | null = null;
  for (const style of BagStyleEnum.options) {
    if (text.includes(style.toLowerCase())) {
      bag_style = style;
      break;
    }
  }

  let bag_size_cm: number | null = null;
  const sizeMatch =
    source_text.match(/\b(\d{2})\s?cm\b/i) ||
    source_text.match(/\b(\d{2})\b/);
  if (sizeMatch) {
    const parsed = Number.parseInt(sizeMatch[1], 10);
    if (Number.isFinite(parsed)) {
      bag_size_cm = parsed;
    }
  }

  let currency: DraftProduct["currency"]["value"] | null = null;
  if (/[£]/.test(source_text) || text.includes("gbp")) currency = "GBP";
  if (/[€]/.test(source_text) || text.includes("eur")) currency = "EUR";
  if (/[$]/.test(source_text) || text.includes("usd")) currency = "USD";

  let price: number | null = null;
  const priceMatch = source_text.match(/([£€$])\s?([\d,]+(?:\.\d+)?)/);
  if (priceMatch) {
    const parsed = Number.parseFloat(priceMatch[2].replace(/,/g, ""));
    if (Number.isFinite(parsed)) price = parsed;
  }

  let receipt: boolean | null = null;
  if (text.includes("receipt")) {
    if (text.includes("no receipt") || text.includes("without receipt")) {
      receipt = false;
    } else {
      receipt = true;
    }
  }

  let stamp: string | null = null;
  const stampMatch = source_text.match(/stamp[:\s]+([A-Za-z0-9-]+)/i);
  if (stampMatch) {
    stamp = stampMatch[1];
  }

  return {
    bag_style,
    bag_size_cm,
    currency: currency ? CurrencyEnum.parse(currency) : null,
    price,
    receipt,
    stamp,
  };
}

function buildSourceText(message: ExtractedMessage): string {
  if (message.text_body) return message.text_body;
  if (message.image_id) return `[image:${message.image_id}]`;
  return `[type:${message.type}]`;
}

function mergeSourceText(existing: string | undefined, next: string): string {
  if (!existing) return next;
  if (existing.includes(next)) return existing;
  return `${existing}\n${next}`;
}

function normalizeSourceMessageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}

function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const match = signatureHeader.match(/^sha256=(.+)$/);
  if (!match) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = match[1];
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

async function processWebhookPayload(payload: unknown) {
  const values = extractMessageValues(payload);
  console.info("wa_webhook values=", values.length);
  const messages = extractMessages(payload);
  console.info("wa_webhook messages=", messages.length);
  if (messages.length > 0) {
    const first = messages[0];
    console.info("wa_webhook first_message=", first.message_id, buildCorrelationId(first.from, first.message_id));
  }
  if (messages.length === 0) return;

  for (const message of messages) {
    const source_text = buildSourceText(message);
    const deal_id = buildCorrelationId(message.from, message.message_id);
    const occurred_at = toIsoFromSeconds(message.timestamp);

    const envelope: AutomationEventEnvelope = {
      event_id: message.message_id,
      source: "whatsapp",
      type: "whatsapp.message",
      occurred_at,
      correlation_id: deal_id,
      shop: null,
      data: {
        message: message.raw_message,
        value: message.raw_value,
        payload,
      },
    };

    try {
      await logEvent(envelope);

      const existing = await getDealSession(deal_id);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      if (!existing) {
        const draft = DraftProductSchema.parse(
          buildStubDraft(source_text, message.message_id, message.from)
        );
        const check = buildCheckMessage({
          deal_id,
          draft_version: 1,
          draft,
        });

        const draftWithCheck = {
          ...draft,
          provenance: {
            ...draft.provenance,
            latest_check: check,
          },
        };

        await createDealSession({
          deal_id,
          correlation_id: deal_id,
          source_message_ids: [message.message_id],
          draft_product: draftWithCheck,
          expires_at: expiresAt,
        });
      } else {
        const draft = DraftProductSchema.parse(existing.draft_product ?? {});
        const provenance = draft.provenance ?? {
          source_text: "",
          source_message_id: undefined,
          source_chat_id: undefined,
        };

        const mergedDraft = {
          ...draft,
          provenance: {
            ...provenance,
            source_text: mergeSourceText(provenance.source_text, source_text),
            source_message_id: message.message_id,
            source_chat_id: message.from,
          },
        };

        const check = buildCheckMessage({
          deal_id,
          draft_version: existing.draft_version,
          draft: mergedDraft,
        });

        mergedDraft.provenance = {
          ...mergedDraft.provenance,
          latest_check: check,
        };

        const nextMessageIds = Array.from(
          new Set([...normalizeSourceMessageIds(existing.source_message_ids), message.message_id])
        );

        await updateDealSession({
          deal_id,
          draft_product: mergedDraft,
          source_message_ids: nextMessageIds,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Failed to process WhatsApp message";
      await logError({
        correlation_id: deal_id,
        service: "whatsapp-webhook",
        error_code: "whatsapp_process_failed",
        message: messageText,
        details: { message_id: message.message_id },
      });
      await logEvent(
        buildEvent({
          correlation_id: deal_id,
          data: { error: messageText, message_id: message.message_id },
        })
      );
    }
  }
}

export async function GET(request: Request) {
  const mode = new URL(request.url).searchParams.get("hub.mode");
  const token = new URL(request.url).searchParams.get("hub.verify_token");
  const challenge = new URL(request.url).searchParams.get("hub.challenge") ?? "";
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (!verifyToken) {
    return new Response("Missing WHATSAPP_VERIFY_TOKEN", { status: 500 });
  }

  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const secret = process.env.META_APP_SECRET;

  if (signature && secret) {
    const valid = verifySignature(rawBody, signature, secret);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 403 });
    }
  } else if (!signature) {
    await logEvent(
      buildEvent({
        correlation_id: "unknown",
        data: { warning: "Missing x-hub-signature-256 header" },
      })
    );
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    void processWebhookPayload(payload).catch(async (error) => {
      const message = error instanceof Error ? error.message : "Failed to process webhook payload";
      await logError({
        correlation_id: "unknown",
        service: "whatsapp-webhook",
        error_code: "whatsapp_process_failed",
        message,
        details: { error },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook payload";
    await logError({
      correlation_id: "unknown",
      service: "whatsapp-webhook",
      error_code: "whatsapp_parse_failed",
      message,
      details: { body_snippet: rawBody.slice(0, 500) },
    });
  }

  return NextResponse.json({ ok: true });
}
