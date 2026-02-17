import { buildCheckMessage } from "@/src/hotbags/checkMessages";
import {
  buildStubDraft,
  mergeSourceText,
  normalizeSourceMessageIds,
} from "@/src/hotbags/draftFromSource";
import { DraftProductSchema } from "@/src/hotbags/schema";
import {
  createDealSession,
  getDealSession,
  logError,
  logEvent,
  updateDealSession,
} from "@/src/platform/db";
import type { AutomationEventEnvelope, EventSource } from "@/src/platform/types";

export type ProcessInboundMessageArgs = {
  event_id: string;
  deal_id: string;
  source: EventSource;
  source_text: string;
  from: string;
  message_id: string;
  occurred_at: string;
  transport_session_id?: string | null;
  raw?: unknown;
};

export type ProcessInboundMessageResult = {
  check: ReturnType<typeof buildCheckMessage>;
  draft_version: number;
};

const SERVICE_TAG = "clawdbot-inbound";

export async function processInboundMessage(
  args: ProcessInboundMessageArgs
): Promise<ProcessInboundMessageResult> {
  const {
    event_id,
    deal_id,
    source,
    source_text,
    from,
    message_id,
    occurred_at,
    transport_session_id,
    raw,
  } = args;

  const envelope: AutomationEventEnvelope = {
    event_id,
    source,
    type: "whatsapp.message",
    occurred_at,
    correlation_id: deal_id,
    shop: null,
    data: {
      message_id,
      from,
      source_text,
      transport_session_id: transport_session_id ?? undefined,
      raw,
    },
  };

  try {
    await logEvent(envelope);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "logEvent failed";
    console.error("processInbound persist_error", {
      stage: "logEvent",
      deal_id,
      message_id,
      error: messageText,
      transport_session_id,
    });
    await logError({
      correlation_id: deal_id,
      event_id: message_id,
      service: SERVICE_TAG,
      error_code: "log_event_failed",
      message: messageText,
      details: { error: error instanceof Error ? error.stack : error },
    });
    throw error;
  }

  const existing = await getDealSession(deal_id);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  if (!existing) {
    const draft = DraftProductSchema.parse(
      buildStubDraft(source_text, message_id, from)
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
      source_message_ids: [message_id],
      draft_product: draftWithCheck,
      expires_at: expiresAt,
    });

    return { check, draft_version: 1 };
  }

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
      source_message_id: message_id,
      source_chat_id: from,
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
    new Set([...normalizeSourceMessageIds(existing.source_message_ids), message_id])
  );

  await updateDealSession({
    deal_id,
    draft_product: mergedDraft,
    source_message_ids: nextMessageIds,
    updated_at: new Date().toISOString(),
  });

  return { check, draft_version: existing.draft_version };
}
