// A delivery is trusted when its signature is the HMAC-SHA256 of the raw body under the webhook
// secret, its timestamp is within a minute, and its delivery id has not been seen: a retry carries
// the same id, so the same work is never done twice (docs: /docs/webhooks).
import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_SKEW_MS = 60_000;

export function signatureOf(rawBody, secret) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(rawBody, signature, secret) {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signatureOf(rawBody, secret), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function isFresh(webhookTimestamp, now = Date.now()) {
  return Number.isFinite(webhookTimestamp) && Math.abs(now - webhookTimestamp) <= MAX_SKEW_MS;
}

/** Remembers the delivery ids seen lately; `first(id)` is true once per id. */
export class Seen {
  #ids = new Map();
  constructor(keepMs = 24 * 60 * 60 * 1000) {
    this.keepMs = keepMs;
  }
  first(id, now = Date.now()) {
    for (const [key, at] of this.#ids) if (now - at > this.keepMs) this.#ids.delete(key);
    if (!id || this.#ids.has(id)) return false;
    this.#ids.set(id, now);
    return true;
  }
}
