import { handleInboundPost } from "@/src/integrations/whatsapp/handleInboundPost";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleInboundPost(request, { logTag: "whatsapp/inbound" });
}
