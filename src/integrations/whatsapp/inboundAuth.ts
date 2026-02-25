import crypto from "crypto";

/**
 * Auth env vars (standardized to match gateway):
 * - HOTBAGS_BEARER_TOKEN: required. Gateway sends Authorization: Bearer <token>.
 * - HOTBAGS_HMAC_SECRET: required when HMAC enabled. HMAC over raw body UTF-8.
 * - HOTBAGS_HMAC_DISABLED: optional; true/false/1/0. Default true (HMAC off) so Bearer-only works
 *   without env vars in Vercel Preview. Set to "false" to require HMAC.
 * Legacy: WHATSAPP_GATEWAY_TOKEN fallback if HOTBAGS_BEARER_TOKEN not set (deprecated).
 */
const BEARER_ENV = "HOTBAGS_BEARER_TOKEN";
const LEGACY_BEARER_ENV = "WHATSAPP_GATEWAY_TOKEN";
const HMAC_SECRET_ENV = "HOTBAGS_HMAC_SECRET";
const HMAC_DISABLED_ENV = "HOTBAGS_HMAC_DISABLED";

export type VerifyResult = { ok: boolean; reason: string };

function isHmacDisabled(): boolean {
  const v = process.env[HMAC_DISABLED_ENV]?.toLowerCase().trim();
  // Explicitly require HMAC
  if (v === "false" || v === "0") return false;
  // Default: HMAC disabled (Bearer-only). Env often unavailable in Vercel Preview.
  return true;
}

export function getBearerToken(): string | undefined {
  const primary = process.env[BEARER_ENV]?.trim();
  if (primary) return primary;
  const legacy = process.env[LEGACY_BEARER_ENV]?.trim();
  if (legacy) {
    console.warn(
      "whatsapp/inbound: WHATSAPP_GATEWAY_TOKEN is deprecated. Migrate to HOTBAGS_BEARER_TOKEN."
    );
    return legacy;
  }
  return undefined;
}

function computeHmac(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

function verifyHmacSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const match = signatureHeader.match(/^sha256=(.+)$/);
  if (!match) return false;
  const expected = computeHmac(rawBody, secret);
  const provided = match[1].trim();
  if (expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Verifies Authorization: Bearer <token> against HOTBAGS_BEARER_TOKEN (or legacy WHATSAPP_GATEWAY_TOKEN).
 */
export function verifyBearer(request: Request): VerifyResult {
  const bearerToken = getBearerToken();
  const auth = request.headers.get("authorization");
  const providedToken = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;

  if (!bearerToken) return { ok: false, reason: "config_missing_secret" };
  if (!auth || !providedToken) return { ok: false, reason: "bearer_missing" };
  if (providedToken !== bearerToken) return { ok: false, reason: "bearer_mismatch" };
  if (providedToken.length === 0) return { ok: false, reason: "bearer_missing" };

  return { ok: true, reason: "ok" };
}

/**
 * Verifies X-HotBags-Signature: sha256=<hex> against HMAC-SHA256(rawBody, HOTBAGS_HMAC_SECRET).
 * If HOTBAGS_HMAC_DISABLED=true, returns ok without verification.
 * If signature header is missing, skips verification (HMAC optional; Bearer alone is sufficient).
 */
export function verifyHmac(request: Request, rawBody: string): VerifyResult {
  if (isHmacDisabled()) return { ok: true, reason: "disabled" };

  const sig = request.headers.get("x-hotbags-signature");
  // No signature sent — skip HMAC (Bearer-only auth is sufficient)
  if (!sig) return { ok: true, reason: "no_signature" };

  const hmacSecret = process.env[HMAC_SECRET_ENV]?.trim();
  if (!hmacSecret) return { ok: false, reason: "config_missing_secret" };

  if (!verifyHmacSignature(rawBody, sig, hmacSecret)) return { ok: false, reason: "signature_mismatch" };

  return { ok: true, reason: "ok" };
}

/**
 * Returns idempotency key from X-Idempotency-Key or Idempotency-Key header (case-insensitive),
 * falling back to payload.message_id.
 */
export function getIdempotencyKey(
  request: Request,
  payload: { message_id: string }
): string {
  return (
    request.headers.get("x-idempotency-key")?.trim() ||
    request.headers.get("idempotency-key")?.trim() ||
    payload.message_id
  );
}

/**
 * Debug info for auth failures (no secrets).
 */
export function getAuthFailureDebug(
  request: Request,
  rawBody: string,
  bearerToken: string | undefined,
  hmacSecret: string | undefined,
  hmacDisabled: boolean
): Record<string, unknown> {
  const auth = request.headers.get("authorization");
  const sig = request.headers.get("x-hotbags-signature");

  return {
    bearer_present: !!auth,
    bearer_length: auth?.startsWith("Bearer ") ? auth.slice(7).trim().length : 0,
    bearer_expected_length: bearerToken?.length ?? 0,
    signature_present: !!sig,
    signature_has_sha256_prefix: !!sig?.startsWith("sha256="),
    hmac_disabled: hmacDisabled,
    hmac_secret_set: !!hmacSecret,
    body_length: rawBody.length,
  };
}

export { computeHmac, isHmacDisabled };
