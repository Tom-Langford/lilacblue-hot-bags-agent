import { NextResponse } from "next/server";
import crypto from "crypto";
import { buildCheckMessage } from "@/src/hotbags/checkMessages";
import {
  buildCorrelationId,
  buildStubDraft,
  mergeSourceText,
  normalizeSourceMessageIds,
} from "@/src/hotbags/draftFromSource";
import { renderCheckText } from "@/src/hotbags/renderCheckText";
import { DraftProductSchema } from "@/src/hotbags/schema";
import { sendTextMessage } from "@/src/whatsapp/client";
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

function buildSourceText(message: ExtractedMessage): string {
  if (message.text_body) return message.text_body;
  if (message.image_id) return `[image:${message.image_id}]`;
  return `[type:${message.type}]`;
}

function getRecipientId(message: ExtractedMessage): string {
  const contacts = message.raw_value.contacts;
  if (Array.isArray(contacts)) {
    const first = contacts[0] as { wa_id?: unknown } | undefined;
    if (first && typeof first.wa_id === "string") {
      return first.wa_id;
    }
  }
  return message.from;
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

function timeoutPromise(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

async function processWebhookPayload(payload: unknown) {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (supabaseUrl) {
    try {
      console.info("wa_webhook env", {
        node_env: process.env.NODE_ENV,
        supabase_url: new URL(supabaseUrl).host,
      });
    } catch {
      console.info("wa_webhook env", { node_env: process.env.NODE_ENV, supabase_url: "invalid" });
    }
  } else {
    console.info("wa_webhook env", { node_env: process.env.NODE_ENV, supabase_url: "missing" });
  }

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
      console.info("wa_webhook before_logEvent", { deal_id, message_id: message.message_id });
      try {
        await Promise.race([
          logEvent(envelope),
          timeoutPromise(3000, "logEvent timeout"),
        ]);
        console.info("wa_webhook event_logged", { event_id: message.message_id });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "logEvent failed";
        console.error("wa_webhook persist_error", {
          stage: "logEvent",
          deal_id,
          message_id: message.message_id,
          error: messageText,
        });
        await logError({
          correlation_id: deal_id,
          event_id: message.message_id,
          service: "whatsapp-webhook",
          error_code: "whatsapp_log_event_failed",
          message: messageText,
          details: { error: error instanceof Error ? error.stack : error },
        });
        return;
      }

      const existing = await getDealSession(deal_id);
      console.info("wa_webhook session_found", { found: !!existing });
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      if (!existing) {
        console.info("wa_webhook before_session_write", { deal_id });
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
        console.info("wa_webhook session_saved", { deal_id, draft_version: 1 });

        if (message.type === "text") {
          const recipient = getRecipientId(message);
          try {
            if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
              console.info("wa_send_check_skipped", {
                deal_id,
                reason: "missing_env",
              });
              return;
            }
            console.info("wa_send_check_start", { deal_id, to: recipient });
            await sendTextMessage({
              phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
              token: process.env.WHATSAPP_TOKEN,
              to: recipient,
              body: renderCheckText(check),
              apiVersion: process.env.WHATSAPP_API_VERSION ?? "v24.0",
            });
            console.info("wa_send_check_ok", { deal_id, to: recipient });
          } catch (error) {
            console.error("wa_send_check_error", {
              deal_id,
              to: recipient,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else {
        console.info("wa_webhook before_session_write", { deal_id });
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
        console.info("wa_webhook session_saved", { deal_id, draft_version: existing.draft_version });

        if (message.type === "text") {
          const recipient = getRecipientId(message);
          try {
            if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
              console.info("wa_send_check_skipped", {
                deal_id,
                reason: "missing_env",
              });
              return;
            }
            console.info("wa_send_check_start", { deal_id, to: recipient });
            await sendTextMessage({
              phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
              token: process.env.WHATSAPP_TOKEN,
              to: recipient,
              body: renderCheckText(check),
              apiVersion: process.env.WHATSAPP_API_VERSION ?? "v24.0",
            });
            console.info("wa_send_check_ok", { deal_id, to: recipient });
          } catch (error) {
            console.error("wa_send_check_error", {
              deal_id,
              to: recipient,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Failed to process WhatsApp message";
      console.error("wa_webhook persist_error", {
        deal_id,
        message_id: message.message_id,
        error: messageText,
      });
      await logError({
        correlation_id: deal_id,
        event_id: message.message_id,
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
    await processWebhookPayload(payload);
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
