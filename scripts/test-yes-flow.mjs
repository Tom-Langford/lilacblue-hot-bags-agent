import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const dealId = `D-${Date.now()}`;

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  return { status: response.status, json };
}

const create = await postJson("/api/dev/deals", {
  deal_id: dealId,
  source_text: "Seller: Birkin 25 Gold Togo GHW, stamp U, £12,500, no receipt",
});

assert.equal(create.status, 200);
assert.equal(create.json?.deal?.deal_id, dealId);

const reply = await postJson(`/api/dev/deals/${dealId}/reply`, { text: "YES" });

assert.equal(reply.status, 200);
assert.equal(reply.json?.deal?.state, "confirmed");
assert.ok(!("check" in reply.json), "YES response should not include check");

console.log("OK: YES flow returns confirmed deal without check");
