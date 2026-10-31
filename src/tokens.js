// The agent's tokens, one per workspace that installed it. An install signs in through
// /oauth/callback (authorization code, actor=app); the pair is kept in data/tokens.json and the
// access token refreshed before it expires. Without an install, MUDEER_AGENT_TOKEN serves one
// workspace (docs: /docs/oauth-2-0-authentication).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "./config.js";

const FILE = new URL("../data/tokens.json", import.meta.url);

function load() {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}
function save(store) {
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(FILE, JSON.stringify(store, null, 2));
}

async function tokenRequest(form) {
  const res = await fetch(`${config.api}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  if (!res.ok) throw new Error(`Token endpoint said ${res.status}: ${await res.text()}`);
  const token = await res.json();
  return { ...token, expiresAt: Date.now() + token.expires_in * 1000 };
}

/** The workspace a token belongs to, from the MCP server's get_workspace (the same tool people's apps call). */
async function workspaceOf(accessToken) {
  const res = await fetch(config.mcp, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_workspace", arguments: {} } }),
  });
  const text = await res.text();
  const line = text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) : text;
  const result = JSON.parse(line ?? "{}").result ?? {};
  const workspace = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "{}");
  return String(workspace.id ?? workspace.workspaceId ?? workspace.key ?? "default");
}

/** The install's callback: trade the code for tokens and remember them under the workspace they open. */
export async function completeInstall({ code }) {
  const token = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri });
  const organizationId = await workspaceOf(token.access_token);
  const store = load();
  store[organizationId] = token;
  save(store);
  return { organizationId, token };
}

/** The address an admin opens to install the agent in their workspace. */
export function installUrl(state) {
  const q = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "read,write,app:mentionable,app:assignable",
    state,
    actor: "app",
  });
  return `${config.app}/oauth/authorize?${q}`;
}

/** A live access token for the workspace: the install's, refreshed when near its end, else the env's. */
export async function accessToken(organizationId) {
  const store = load();
  const token = store[organizationId];
  if (!token) {
    if (config.agentToken) return config.agentToken;
    throw new Error(`No token for workspace ${organizationId}: install the agent there, or set MUDEER_AGENT_TOKEN`);
  }
  if (token.expiresAt - Date.now() > 5 * 60 * 1000) return token.access_token;
  const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refresh_token });
  store[organizationId] = fresh;
  save(store);
  return fresh.access_token;
}
