# lilacblue-hot-bags-agent
Internal WhatsApp → Shopify automation for surfacing time-sensitive luxury bag deals. Uses AI with human confirmation to ensure clean product data, controlled publishing, and automatic 24-hour expiry.

## WhatsApp Webhook Verification
Set `WHATSAPP_VERIFY_TOKEN` in the environment, then configure the Meta Webhooks UI:
- Callback URL: `https://<your-host>/api/whatsapp/webhook`
- Verify token: the exact value of `WHATSAPP_VERIFY_TOKEN`

When Meta hits the verification endpoint, the server responds with the `hub.challenge` value as plain text.
