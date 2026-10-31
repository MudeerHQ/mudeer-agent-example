import { test } from "node:test";
import assert from "node:assert/strict";
import { Seen, isFresh, signatureOf, verifySignature } from "../src/verify.js";

const secret = "mdr_wh_" + "a".repeat(40);
const body = Buffer.from(JSON.stringify({ type: "AgentSessionEvent", action: "created", webhookTimestamp: 1792487643180 }));

test("a delivery signed with the secret verifies; a changed byte does not", () => {
  const signature = signatureOf(body, secret);
  assert.equal(verifySignature(body, signature, secret), true);
  assert.equal(verifySignature(Buffer.concat([body, Buffer.from(" ")]), signature, secret), false);
  assert.equal(verifySignature(body, signature, secret + "b"), false);
  assert.equal(verifySignature(body, "not-hex", secret), false);
  assert.equal(verifySignature(body, undefined, secret), false);
});

test("a timestamp within a minute is fresh; older is not", () => {
  const now = 1_800_000_000_000;
  assert.equal(isFresh(now - 59_000, now), true);
  assert.equal(isFresh(now - 61_000, now), false);
  assert.equal(isFresh(NaN, now), false);
});

test("a delivery id is handled once; a retry with the same id is skipped", () => {
  const seen = new Seen(1000);
  assert.equal(seen.first("d1", 0), true);
  assert.equal(seen.first("d1", 10), false);
  assert.equal(seen.first("d2", 10), true);
  assert.equal(seen.first(undefined, 10), false);
  // Forgotten after its keep time, so memory stays small.
  assert.equal(seen.first("d1", 2000), true);
});
