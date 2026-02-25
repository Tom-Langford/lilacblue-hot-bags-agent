import { NextResponse } from "next/server";
import { z } from "zod";
import { buildCorrelationId } from "@/src/hotbags/draftFromSource";
import { renderCheckText } from "@/src/hotbags/renderCheckText";
import { processInboundMessage } from "@/src/integrations/whatsapp/processInbound";
import {
  verifyBearer,
  verifyHmac,
  getIdempotencyKey,
  getAuthFailureDebug,
  getBearerToken,
} from "@/src/integrations/whatsapp/inboundAuth";
import { logError } from "@/src/platform/db";

export const InboundPayloadSchema = z.object({
  message_id: z.string().min(1),
  chat_id: z.string().optional(),
  from: z.string().min(1),
  text: z.string().optional(),
  media: z.array(z.unknown()).optional().default([]),
  timestamp: z.union([z.number(), z.string()]),
  raw: z.unknown().optional(),
  transport_session_id: z.string().optional(),
});

function toOccurredAt(timestamp: number | string): string {
  if (typeof timestamp === "number") {
    return new Date(timestamp * 1000).toISOString();
  }
  const str = String(timestamp);
  const parsed = Number.parseInt(str, 10);
  if (Number.isFinite(parsed) && String(parsed) === str) {
    return new Date(parsed * 1000).toISOString();
  }
  const d = new Date(str);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function buildSourceText(payload: z.infer<typeof InboundPayloadSchema>): string {
  if (payload.text != null && payload.text !== "") return payload.text;
  if (payload.media?.length) {
    return `[image:${payload.media.length}]`;
  }
  return "[type:unknown]";
}

export type HandleInboundPostOptions = {
  /** Log tag for auth failures and errors (e.g. "whatsapp/inbound" or "gateway/inbound") */
  logTag: string;
};

/**
 * Shared POST handler for gateway inbound messages.
 * Used by both /api/integrations/whatsapp/inbound and /api/gateway/inbound.
 */
export async function handleInboundPost(
  request: Request,
  options: HandleInboundPostOptions
): Promise<Response> {
  const { logTag } = options;
  const rawBody = await request.text();

  // DEBUG: remove after confirming HMAC_DISABLED works
  console.log("gateway/inbound env", {
    HOTBAGS_HMAC_DISABLED: process.env.HOTBAGS_HMAC_DISABLED,
    hmacDisabled: process.env.HOTBAGS_HMAC_DISABLED?.toLowerCase().trim() === "true" ||
      process.env.HOTBAGS_HMAC_DISABLED?.toLowerCase().trim() === "1",
  });

  const bearerResult = verifyBearer(request);
  if (!bearerResult.ok) {
    const bearerToken = getBearerToken();
    const debug = getAuthFailureDebug(request, rawBody, bearerToken, undefined, false);
    debug.failure_reason = bearerResult.reason;
    console.warn(`${logTag} auth_fail`, debug);
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const hmacResult = verifyHmac(request, rawBody);
  if (!hmacResult.ok) {
    if (hmacResult.reason === "config_missing_secret") {
      console.error(
        `${logTag}: HOTBAGS_HMAC_SECRET is required when HOTBAGS_HMAC_DISABLED is not true`
      );
      return NextResponse.json(
        { ok: false, error: "Server configuration error: HMAC secret not configured" },
        { status: 500 }
      );
    }
    const bearerToken = getBearerToken();
    const hmacSecret = process.env.HOTBAGS_HMAC_SECRET?.trim();
    const debug = getAuthFailureDebug(request, rawBody, bearerToken, hmacSecret, false);
    debug.failure_reason = hmacResult.reason;
    console.warn(`${logTag} auth_fail`, debug);
    return NextResponse.json(
      { ok: false, error: "Invalid signature" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = InboundPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const event_id = getIdempotencyKey(request, payload);
  const deal_id = buildCorrelationId(payload.from, payload.message_id);
  const source_text = buildSourceText(payload);
  const occurred_at = toOccurredAt(payload.timestamp);

  try {
    const { check } = await processInboundMessage({
      event_id,
      deal_id,
      source: "clawdbot",
      source_text,
      from: payload.from,
      message_id: payload.message_id,
      occurred_at,
      transport_session_id: payload.transport_session_id ?? null,
      raw: payload.raw,
    });

    const commands: Array<{ command_id: string; type: string; text?: string }> = [];
    if (payload.text != null && payload.text !== "") {
      commands.push({
        command_id: `${event_id}:send_check`,
        type: "send_text",
        text: renderCheckText(check),
      });
    }

    return NextResponse.json({ ok: true, commands });
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "processInbound failed";
    console.error(`${logTag} error`, {
      deal_id,
      message_id: payload.message_id,
      error: messageText,
      transport_session_id: payload.transport_session_id,
    });
    await logError({
      correlation_id: deal_id,
      event_id: payload.message_id,
      service: "clawdbot-inbound",
      error_code: "process_failed",
      message: messageText,
      details: { error: error instanceof Error ? error.stack : error },
    });
    return NextResponse.json(
      { ok: false, error: "Processing failed" },
      { status: 500 }
    );
  }
}
