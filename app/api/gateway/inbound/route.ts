import { handleInboundPost } from "@/src/integrations/whatsapp/handleInboundPost";

export const runtime = "nodejs";

/**
 * Gateway inbound endpoint.
 * Accepts normalized WhatsApp messages from clawdbot (whatsapp-web.js gateway on Oracle VM).
 * Same contract as /api/integrations/whatsapp/inbound:
 * - Auth: Bearer token (HOTBAGS_BEARER_TOKEN) + optional HMAC (X-HotBags-Signature)
 * - Body: { message_id, from, text?, media?, timestamp, ... }
 * - Response: { ok: true, commands: [...] }
 */
export async function POST(request: Request) {
  return handleInboundPost(request, { logTag: "gateway/inbound" });
}
