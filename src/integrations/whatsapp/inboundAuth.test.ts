import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  verifyBearer,
  verifyHmac,
  getIdempotencyKey,
  computeHmac,
  isHmacDisabled,
} from "./inboundAuth";

const BEARER = "HOTBAGS_BEARER_TOKEN";
const HMAC_SECRET = "HOTBAGS_HMAC_SECRET";
const HMAC_DISABLED = "HOTBAGS_HMAC_DISABLED";

function makeRequest(init: RequestInit = {}): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    ...init,
  });
}

function restoreEnv(orig: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(orig)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("inboundAuth", () => {
  let origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    origEnv = {
      [BEARER]: process.env[BEARER],
      [HMAC_SECRET]: process.env[HMAC_SECRET],
      [HMAC_DISABLED]: process.env[HMAC_DISABLED],
      WHATSAPP_GATEWAY_TOKEN: process.env.WHATSAPP_GATEWAY_TOKEN,
    };
  });

  afterEach(() => {
    restoreEnv(origEnv);
  });

  describe("verifyBearer", () => {
    it("returns ok when bearer matches", () => {
      process.env[BEARER] = "secret-token";
      const req = makeRequest({
        headers: { Authorization: "Bearer secret-token" },
      });
      expect(verifyBearer(req)).toEqual({ ok: true, reason: "ok" });
    });

    it("returns bearer_mismatch when token differs", () => {
      process.env[BEARER] = "secret-token";
      const req = makeRequest({
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(verifyBearer(req)).toEqual({ ok: false, reason: "bearer_mismatch" });
    });

    it("returns bearer_missing when no auth header", () => {
      process.env[BEARER] = "secret-token";
      const req = makeRequest();
      expect(verifyBearer(req)).toEqual({ ok: false, reason: "bearer_missing" });
    });

    it("returns bearer_missing when Bearer prefix missing", () => {
      process.env[BEARER] = "secret-token";
      const req = makeRequest({
        headers: { Authorization: "secret-token" },
      });
      expect(verifyBearer(req)).toEqual({ ok: false, reason: "bearer_missing" });
    });

    it("returns config_missing_secret when token not set", () => {
      delete process.env[BEARER];
      delete process.env.WHATSAPP_GATEWAY_TOKEN;
      const req = makeRequest({
        headers: { Authorization: "Bearer any" },
      });
      expect(verifyBearer(req)).toEqual({ ok: false, reason: "config_missing_secret" });
    });

    it("accepts bearer with leading/trailing whitespace trimmed", () => {
      process.env[BEARER] = "secret-token";
      const req = makeRequest({
        headers: { Authorization: "Bearer  secret-token  " },
      });
      expect(verifyBearer(req)).toEqual({ ok: true, reason: "ok" });
    });
  });

  describe("verifyHmac", () => {
    const rawBody = '{"message_id":"x","from":"y","timestamp":0}';
    const validHex = computeHmac(rawBody, "my-secret");

    it("returns ok when signature matches", () => {
      process.env[HMAC_SECRET] = "my-secret";
      process.env[HMAC_DISABLED] = "false";
      const req = makeRequest({
        headers: { "X-HotBags-Signature": `sha256=${validHex}` },
      });
      expect(verifyHmac(req, rawBody)).toEqual({ ok: true, reason: "ok" });
    });

    it("returns signature_mismatch when hex wrong", () => {
      process.env[HMAC_SECRET] = "my-secret";
      process.env[HMAC_DISABLED] = "false";
      const req = makeRequest({
        headers: { "X-HotBags-Signature": "sha256=deadbeef" },
      });
      expect(verifyHmac(req, rawBody)).toEqual({ ok: false, reason: "signature_mismatch" });
    });

    it("returns ok (no_signature) when header absent — HMAC optional", () => {
      process.env[HMAC_SECRET] = "my-secret";
      process.env[HMAC_DISABLED] = "false";
      const req = makeRequest();
      expect(verifyHmac(req, rawBody)).toEqual({ ok: true, reason: "no_signature" });
    });

    it("returns config_missing_secret when secret not set and not disabled", () => {
      delete process.env[HMAC_SECRET];
      process.env[HMAC_DISABLED] = "false";
      const req = makeRequest({
        headers: { "X-HotBags-Signature": `sha256=${validHex}` },
      });
      expect(verifyHmac(req, rawBody)).toEqual({ ok: false, reason: "config_missing_secret" });
    });

    it("returns ok (disabled) when HOTBAGS_HMAC_DISABLED=true", () => {
      delete process.env[HMAC_SECRET];
      process.env[HMAC_DISABLED] = "true";
      const req = makeRequest();
      expect(verifyHmac(req, rawBody)).toEqual({ ok: true, reason: "disabled" });
    });

    it("returns ok (disabled) when HOTBAGS_HMAC_DISABLED=1", () => {
      delete process.env[HMAC_SECRET];
      process.env[HMAC_DISABLED] = "1";
      const req = makeRequest();
      expect(verifyHmac(req, rawBody)).toEqual({ ok: true, reason: "disabled" });
    });

    it("rejects signature without sha256= prefix", () => {
      process.env[HMAC_SECRET] = "my-secret";
      process.env[HMAC_DISABLED] = "false";
      const req = makeRequest({
        headers: { "X-HotBags-Signature": validHex },
      });
      expect(verifyHmac(req, rawBody)).toEqual({ ok: false, reason: "signature_mismatch" });
    });
  });

  describe("getIdempotencyKey", () => {
    const payload = { message_id: "msg-123" };

    it("returns X-Idempotency-Key when present", () => {
      const req = makeRequest({
        headers: { "X-Idempotency-Key": "key-from-header" },
      });
      expect(getIdempotencyKey(req, payload)).toBe("key-from-header");
    });

    it("returns Idempotency-Key when X-Idempotency-Key absent", () => {
      const req = makeRequest({
        headers: { "Idempotency-Key": "key-standard" },
      });
      expect(getIdempotencyKey(req, payload)).toBe("key-standard");
    });

    it("prefers X-Idempotency-Key over Idempotency-Key", () => {
      const req = makeRequest({
        headers: {
          "X-Idempotency-Key": "x-key",
          "Idempotency-Key": "std-key",
        },
      });
      expect(getIdempotencyKey(req, payload)).toBe("x-key");
    });

    it("falls back to message_id when no headers", () => {
      const req = makeRequest();
      expect(getIdempotencyKey(req, payload)).toBe("msg-123");
    });

    it("accepts header casing (HTTP headers are case-insensitive)", () => {
      const req = makeRequest({
        headers: { "x-idempotency-key": "lower-key" },
      });
      expect(getIdempotencyKey(req, payload)).toBe("lower-key");
    });
  });
});
