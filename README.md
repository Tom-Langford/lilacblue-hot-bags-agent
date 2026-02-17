# lilacblue-hot-bags-agent
Internal WhatsApp → Shopify automation for surfacing time-sensitive luxury bag deals. Uses AI with human confirmation to ensure clean product data, controlled publishing, and automatic 24-hour expiry.

## WhatsApp Webhook Verification
Set `WHATSAPP_VERIFY_TOKEN` in the environment, then configure the Meta Webhooks UI:
- Callback URL: `https://<your-host>/api/whatsapp/webhook`
- Verify token: the exact value of `WHATSAPP_VERIFY_TOKEN`

When Meta hits the verification endpoint, the server responds with the `hub.challenge` value as plain text.

## WhatsApp Inbound Integration (Gateway / ClawdBot)

For the transport-neutral inbound path (e.g. ClawdBot on an always-on VM):

- **Endpoint:** `POST /api/integrations/whatsapp/inbound`
- **Auth:** Set `WHATSAPP_GATEWAY_TOKEN` in the environment. The Gateway must send `Authorization: Bearer <token>`.
- **Body:** Normalized payload with `message_id`, `from`, `text`, `media` (optional), `timestamp`, and optional `transport_session_id`, `raw`.
- **Response:** `{ ok: true, commands: [ { command_id, type: "send_text", text } ] }`. The Gateway dedupes by `command_id` and sends at most once per command.
- **Idempotency:** Use `message_id` as the idempotency key (or send `Idempotency-Key` header). Events are logged with `source: "clawdbot"`.
