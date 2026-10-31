// A delivery is trusted when its signature is the HMAC-SHA256 of the raw body under the webhook
// secret, its timestamp is within a minute, and its delivery id has not been handled: a retry
// carries the same id, so the same work is never done twice (docs: /docs/webhooks). Web Crypto
// only, so it runs in a Worker and in Node alike.

export const MAX_SKEW_MS = 60_000;
const encoder = new TextEncoder();

async function hmac(rawBody: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)));
}

export async function signatureOf(rawBody: string, secret: string): Promise<string> {
  return Array.from(await hmac(rawBody, secret), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifySignature(rawBody: string, signature: string | null | undefined, secret: string): Promise<boolean> {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = await hmac(rawBody, secret);
  const given = Uint8Array.from(signature.match(/../g)!.map((h) => parseInt(h, 16)));
  // Constant time: every byte is compared whatever the first difference.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ given[i];
  return diff === 0;
}

export function isFresh(webhookTimestamp: unknown, now = Date.now()): boolean {
  return typeof webhookTimestamp === "number" && Number.isFinite(webhookTimestamp) && Math.abs(now - webhookTimestamp) <= MAX_SKEW_MS;
}

/** The part of KV this needs, so a test can hand in a Map. */
export interface Seen {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** True once per delivery id; a retry of one already handled is false. Remembered for a day. */
export async function firstDelivery(store: Seen, deliveryId: string | null | undefined): Promise<boolean> {
  if (!deliveryId) return false;
  const key = `delivery:${deliveryId}`;
  if (await store.get(key)) return false;
  await store.put(key, "1", { expirationTtl: 24 * 60 * 60 });
  return true;
}
