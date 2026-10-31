import { test } from "node:test";
import assert from "node:assert/strict";
import { firstDelivery, isFresh, signatureOf, verifySignature, type Seen } from "../src/lib/verify.ts";

const secret = "mdr_wh_" + "a".repeat(40);
const body = JSON.stringify({ type: "AgentSessionEvent", action: "created", webhookTimestamp: 1792487643180 });

test("a delivery signed with the secret verifies; a changed byte or secret does not", async () => {
  const signature = await signatureOf(body, secret);
  assert.equal(await verifySignature(body, signature, secret), true);
  assert.equal(await verifySignature(body + " ", signature, secret), false);
  assert.equal(await verifySignature(body, signature, secret + "b"), false);
  assert.equal(await verifySignature(body, "not-hex", secret), false);
  assert.equal(await verifySignature(body, null, secret), false);
});

test("the signature is Mudeer's: lowercase hex HMAC-SHA256 of the raw body", async () => {
  // Checked against Node's crypto for the same bytes.
  const { createHmac } = await import("node:crypto");
  assert.equal(await signatureOf(body, secret), createHmac("sha256", secret).update(body).digest("hex"));
});

test("a timestamp within a minute is fresh; older, or not a number, is not", () => {
  const now = 1_800_000_000_000;
  assert.equal(isFresh(now - 59_000, now), true);
  assert.equal(isFresh(now - 61_000, now), false);
  assert.equal(isFresh("1800000000000", now), false);
});

test("a delivery id is handled once; a retry with the same id is skipped", async () => {
  const map = new Map<string, string>();
  const store: Seen = { get: async (k) => map.get(k) ?? null, put: async (k, v) => void map.set(k, v) };
  assert.equal(await firstDelivery(store, "d1"), true);
  assert.equal(await firstDelivery(store, "d1"), false);
  assert.equal(await firstDelivery(store, "d2"), true);
  assert.equal(await firstDelivery(store, null), false);
});
