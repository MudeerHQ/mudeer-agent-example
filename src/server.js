// The HTTP side: Mudeer's webhook at POST /webhook, the install's return at GET /oauth/callback,
// and GET /install to start one. Answers the webhook within 5 seconds and does the work after.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { handle } from "./agent.js";
import { Seen, isFresh, verifySignature } from "./verify.js";
import { completeInstall, installUrl } from "./tokens.js";

const seen = new Seen();
const states = new Set();

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/webhook") {
    const raw = await readRaw(req);
    if (!verifySignature(raw, req.headers["mudeer-signature"], config.webhookSecret())) return res.writeHead(401).end();
    let event;
    try {
      event = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.writeHead(400).end();
    }
    if (!isFresh(event.webhookTimestamp)) return res.writeHead(401).end();
    // 200 at once; the work after. A retry of a delivery already seen is acknowledged and skipped.
    res.writeHead(200).end();
    if (seen.first(req.headers["mudeer-delivery"])) {
      handle(event).catch((error) => console.error("handle failed", error));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/install") {
    const state = randomBytes(16).toString("hex");
    states.add(state);
    return res.writeHead(302, { Location: installUrl(state) }).end();
  }

  if (req.method === "GET" && url.pathname === "/oauth/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !states.delete(state)) return res.writeHead(400).end("Bad state");
    try {
      const { organizationId } = await completeInstall({ code });
      return res
        .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
        .end(`Installed in workspace ${organizationId}. You can close this tab.`);
    } catch (error) {
      return res.writeHead(502).end(error.message);
    }
  }

  if (url.pathname === "/health") return res.writeHead(200).end("ok");
  res.writeHead(404).end();
});

server.listen(config.port, () => console.log(`Agent listening on :${config.port} (POST /webhook, GET /install)`));
