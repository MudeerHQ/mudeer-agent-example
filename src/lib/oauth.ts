// The install and the agent's tokens, one per workspace: an admin opens /install, Mudeer sends
// them back to /oauth/callback with a code, the code becomes an access and a refresh token kept
// in KV under the workspace, refreshed before they expire (docs: /docs/oauth-2-0-authentication).
import type { Env, StoredToken } from "./types.ts";

const tokenKey = (organizationId: string) => `token:${organizationId}`;

async function tokenRequest(env: Env, form: Record<string, string>): Promise<StoredToken> {
  const res = await fetch(`${env.MUDEER_API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.MUDEER_CLIENT_ID}:${env.MUDEER_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  if (!res.ok) throw new Error(`Token endpoint said ${res.status}: ${await res.text()}`);
  const token = (await res.json()) as Omit<StoredToken, "expiresAt">;
  return { ...token, expiresAt: Date.now() + token.expires_in * 1000 };
}

/** Which workspace a token opens: the MCP server's get_workspace, the same tool people's apps call. */
async function workspaceOf(env: Env, accessToken: string): Promise<string> {
  const res = await fetch(env.MUDEER_MCP, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_workspace", arguments: {} } }),
  });
  const text = await res.text();
  const line = /^(event|data):/.test(text) ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) : text;
  const result = (JSON.parse(line ?? "{}").result ?? {}) as { structuredContent?: Record<string, unknown>; content?: Array<{ text?: string }> };
  const workspace = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "{}");
  return String(workspace.id ?? workspace.workspaceId ?? workspace.key ?? "default");
}

/** GET /install: a state for ten minutes, then Mudeer's consent page with actor=app. */
export async function handleInstall(env: Env): Promise<Response> {
  const state = crypto.randomUUID();
  await env.STORE.put(`state:${state}`, "1", { expirationTtl: 600 });
  const q = new URLSearchParams({
    client_id: env.MUDEER_CLIENT_ID,
    redirect_uri: `${env.WORKER_URL}/oauth/callback`,
    response_type: "code",
    scope: "read,write,app:mentionable,app:assignable",
    state,
    actor: "app",
  });
  return Response.redirect(`${env.MUDEER_APP}/oauth/authorize?${q}`, 302);
}

/** GET /oauth/callback: the code becomes tokens, kept under the workspace they open. */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !(await env.STORE.get(`state:${state}`))) return new Response("Bad state", { status: 400 });
  await env.STORE.delete(`state:${state}`);
  try {
    const token = await tokenRequest(env, { grant_type: "authorization_code", code, redirect_uri: `${env.WORKER_URL}/oauth/callback` });
    const organizationId = await workspaceOf(env, token.access_token);
    await env.STORE.put(tokenKey(organizationId), JSON.stringify(token));
    return new Response(`Installed in workspace ${organizationId}. You can close this tab.`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    return new Response((error as Error).message, { status: 502 });
  }
}

/** A live access token for the workspace, refreshed when within five minutes of its end. */
export async function accessToken(env: Env, organizationId: string): Promise<string> {
  const stored = await env.STORE.get<StoredToken>(tokenKey(organizationId), "json");
  if (!stored) throw new Error(`No token for workspace ${organizationId}: install the agent there first (/install)`);
  if (stored.expiresAt - Date.now() > 5 * 60 * 1000) return stored.access_token;
  if (!stored.refresh_token) throw new Error(`The token for ${organizationId} expired and cannot be refreshed`);
  const fresh = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: stored.refresh_token });
  await env.STORE.put(tokenKey(organizationId), JSON.stringify(fresh));
  return fresh.access_token;
}

/** The workspace revoked the install (OAuthApp revoked): its tokens are gone. */
export async function forgetWorkspace(env: Env, organizationId: string): Promise<void> {
  await env.STORE.delete(tokenKey(organizationId));
}

/** Every workspace the agent holds a token for. */
export async function installedWorkspaces(env: Env): Promise<string[]> {
  const list = await env.STORE.list({ prefix: "token:" });
  return list.keys.map((k) => k.name.slice("token:".length));
}
