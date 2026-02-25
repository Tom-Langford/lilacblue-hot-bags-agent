# Plan: Setting Up ClawdBot (WhatsApp Gateway) on Oracle Cloud VM

This plan describes how to run the WhatsApp transport on an always-on Oracle Cloud VM so it integrates with the Hot Bags backend. See the **ClawdBot architecture summary** (components, Hot Bags contract, command_id dedupe, idempotency) for the interface and trust boundary. No code in this repo—gateway can be a separate repo or a small service alongside OpenClaw.

---

## 1. Oracle VM basics

- **Shape:** Small always-on instance (e.g. AMD 1 OCPU, 1–6 GB RAM). WhatsApp session + retry queue and optional OpenClaw need minimal CPU; 24/7 uptime matters.
- **OS:** Ubuntu 22.04 or 24.04 LTS (or Oracle Linux if you prefer; steps assume Debian/Ubuntu).
- **Network:** Allow outbound HTTPS to Hot Bags (Vercel) and to WhatsApp (Baileys/Web). No inbound ports required unless you expose a Control UI or health endpoint; if you do, restrict by IP and use TLS.
- **Storage:** Persistent volume for session auth (Baileys auth dir), optional SQLite/file for retry queue and `command_id` dedupe store. 10–20 GB is plenty.

---

## 2. Node.js and OpenClaw (WhatsApp session)

- **Node 22+:** Required by OpenClaw. Install via NodeSource on Ubuntu:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **OpenClaw (ClawdBot):** Install globally and ensure `openclaw` is on PATH:
  ```bash
  npm install -g openclaw
  export PATH="$(npm prefix -g)/bin:$PATH"   # add to ~/.bashrc / ~/.zshrc
  ```
- **Config directory:** `~/.openclaw/` (or a dedicated user’s home). Use `~/.openclaw/openclaw.json` for channel and gateway settings.
- **WhatsApp (Baileys Web):** In config, enable the web channel and WhatsApp:
  ```json5
  {
    channels: {
      whatsapp: {
        dmPolicy: "allowlist",   // or "open" with allowFrom: ["*"]
        allowFrom: ["+44..."],   // numbers that may message Hot Bags deals
      },
    },
    web: { enabled: true },
  }
  ```
- **Link WhatsApp (one-time or after re-auth):** From a session with display (SSH + terminal or VNC):
  ```bash
  openclaw channels login --channel whatsapp
  ```
  Scan QR with the phone that will receive/send deal messages. Auth is stored under `~/.openclaw/` (or configured `authDir`). Keep this directory backed up and secure.
- **Run gateway 24/7:** Use systemd (or a process manager). Example unit:
  - **ExecStart:** `openclaw gateway` (or `node /path/to/standalone-gateway.js` if not using OpenClaw).
  - **User:** Dedicated user (e.g. `openclaw`), not root.
  - **Restart:** `always`, **RestartSec:** 10.
  - **Environment:** Set `OPENCLAW_*` or env file for config overrides; do not put secrets in the unit file—use env file with restricted permissions or a secrets manager.

---

## 3. Gateway logic (bridge to Hot Bags)

The VM must run a “gateway” that (1) receives every inbound WhatsApp message from the session, (2) POSTs it to Hot Bags with idempotency, (3) executes the returned commands with `command_id` dedupe, (4) retries when Hot Bags is unavailable. Two implementation options:

**Option A – Standalone gateway (recommended)**  
- A small Node service that uses **Baileys** (or the same WhatsApp Web stack OpenClaw uses) to maintain a single WhatsApp session. No OpenClaw dependency.  
- On each inbound message: build the normalized payload (`message_id`, `chat_id`, `from`, `text`, `media[]`, `timestamp`, `raw`), POST to `https://<hot-bags>/api/integrations/whatsapp/inbound` with:
  - **Headers:** `Authorization: Bearer <HOTBAGS_BEARER_TOKEN>`, `X-HotBags-Signature: sha256=<hex>` (unless HMAC disabled), `Idempotency-Key` or `X-Idempotency-Key: <message_id>`, optional `X-Transport-Session-Id`.
  - **Body:** JSON matching the Hot Bags contract.
- On **2xx response:** Parse `commands[]`. For each command with `command_id`, check a local dedupe store (e.g. SQLite or file); if not seen, execute (e.g. `type: "send_text"` → send text to `from`/chat), then record `command_id` as executed.
- On **non-2xx or network error:** Push payload (and idempotency key) to a retry queue. Background worker retries with backoff; same idempotency key yields same response and same `command_id`s, so command dedupe still prevents double-send after retry.
- **Session persistence:** Use Baileys auth dir on the persistent volume; restarting the process reuses the session. Handle QR re-login when session is invalid (e.g. log and alert; operator rescans).

**Option B – OpenClaw + bridge**  
- Run OpenClaw for WhatsApp only (no AI agent, or a minimal agent). Use a **plugin or sidecar** that subscribes to OpenClaw’s inbound message events (if the project exposes them), builds the same normalized payload, and POSTs to Hot Bags; then sends replies via OpenClaw’s outbound API (e.g. hooks or gateway API) using the returned commands.  
- **Constraint:** OpenClaw’s public docs focus on AI agents and inbound hooks (HTTP → OpenClaw). Outbound “on WhatsApp message → call our URL” may require a custom plugin or forking. Prefer Option A unless you already use OpenClaw and have a clear event/callback API.

---

## 4. Auth and secrets (Gateway → Hot Bags)

- **Hot Bags env vars:** `HOTBAGS_BEARER_TOKEN` (required). `HOTBAGS_HMAC_SECRET` and `HOTBAGS_HMAC_DISABLED=false` only if you want HMAC (default: HMAC off).
- **Authentication:** Align with Hot Bags:
  - **Bearer token:** `Authorization: Bearer <token>`. Must match `HOTBAGS_BEARER_TOKEN`.
  - **HMAC:** Optional. Default: disabled. To enable, set `HOTBAGS_HMAC_DISABLED=false` and `HOTBAGS_HMAC_SECRET`. Gateway sends `X-HotBags-Signature: sha256=<hex>`.
- **Replay protection:** Hot Bags uses idempotency key (e.g. `message_id`); Gateway sends it via `Idempotency-Key` or `X-Idempotency-Key` header.
- **Secrets on Oracle VM:** Use instance metadata or a small secrets store; inject into the gateway process via env or env file with restricted permissions (e.g. `chmod 600 .env`).

---

## 5. Idempotency and command dedupe (Gateway side)

- **Idempotency key:** Send the same key (e.g. `message_id`) for the same logical message. On retry, use the same key so Hot Bags returns the same `commands[]` with the same `command_id`s.
- **Command dedupe:** Maintain a store (e.g. SQLite table or file) of “executed `command_id`s”. Before executing a command from the response, check if `command_id` is already stored; if yes, skip. After executing, persist `command_id`. This guarantees at-most-once send per command even when Hot Bags is re-called after a retry.
- **Retry queue:** Persist failed requests (payload + idempotency key) to disk so a process restart doesn’t lose them. On success, remove from queue. Limit retries (e.g. max 24 hours or 100 attempts) and dead-letter or alert.

---

## 6. Payload and contract alignment

- **Outbound (Gateway → Hot Bags):** Exactly match the Hot Bags contract:
  - `message_id`, `chat_id`, `from`, `text`, `media[]`, `timestamp`, `raw`
  - Optional: `transport_session_id` (e.g. stable session id from Baileys/OpenClaw for correlation).
- **Inbound (Hot Bags → Gateway):** Parse `commands[]`. For `type: "send_text"`, send `text` to the chat that triggered the request (e.g. `from` or `chat_id`). Ignore unknown types or log and skip. Use `command_id` only for dedupe, not for ordering (order is defined by the array).

---

## 7. Session stability and ops

- **Reconnect:** Baileys/WhatsApp Web can disconnect. Gateway (or OpenClaw) should auto-reconnect with backoff. On persistent failure (e.g. logged out), require a new QR scan; alert so someone can run `openclaw channels login --channel whatsapp` again.
- **Monitoring:** Simple health check (e.g. “session connected” + “last successful POST to Hot Bags within N minutes”). Optionally expose a `/health` on localhost and have a cron or external monitor hit it. Log errors and retry exhaustion.
- **Logging:** Tag logs with `transport_session_id` and `message_id` so you can correlate with Hot Bags (source: `clawdbot`) and debug duplicates or missing replies.
- **Updates:** Plan Node and OpenClaw (or Baileys) upgrades during low-traffic windows; test re-login and one full round-trip (message → Hot Bags → command → WhatsApp) after each change.

---

## 8. Checklist (no code)

1. **Provision Oracle VM:** Ubuntu 22/24, always-on, outbound HTTPS, persistent volume for auth and optional DB/files.
2. **Install Node 22+ and OpenClaw** (or only Node + Baileys for Option A); ensure PATH and user permissions.
3. **Configure WhatsApp:** `openclaw.json` (or equivalent) with WhatsApp/web channel and allowlist; link session via `openclaw channels login --channel whatsapp`.
4. **Implement or deploy gateway service:** Inbound message → build payload → POST to Hot Bags with auth + idempotency key; parse `commands[]`, dedupe by `command_id`, execute send_text; retry queue for failures.
5. **Secrets:** Store `HOTBAGS_BEARER_TOKEN`, `HOTBAGS_HMAC_SECRET` (unless disabled), and any API URLs in env/vault; configure gateway to use them.
6. **Systemd (or equivalent):** Run gateway (and OpenClaw if used) under a dedicated user with Restart=always; use env file for secrets.
7. **Verify end-to-end:** Send a test WhatsApp message, confirm Hot Bags receives it (check Supabase event + deal), confirm reply appears in WhatsApp exactly once after retries.
8. **Document:** Where auth dir lives, how to re-scan QR, how to inspect retry queue and command_id store, and how Hot Bags contract is versioned (if ever).

After this, the Oracle VM is the single place that holds the WhatsApp session and talks to Hot Bags; Vercel Hot Bags stays the source of truth and returns only commands for the gateway to execute.
