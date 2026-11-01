// What the agent says to Mudeer: activities and the session's plan and links over REST, and reads
// over the MCP server with the same token, the same tools people's AI apps use
// (docs: /docs/agent-interaction, /docs/mcp).
import { accessToken } from "./oauth.ts";
import type { ActivityContent, Env, SelectOption } from "./types.ts";

interface Envelope<T> {
  success: boolean;
  data: T;
  error: { message?: string } | null;
}

export class Mudeer {
  private readonly env: Env;
  readonly organizationId: string;
  constructor(env: Env, organizationId: string) {
    this.env = env;
    this.organizationId = organizationId;
  }

  private async rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await accessToken(this.env, this.organizationId);
    const res = await fetch(`${this.env.MUDEER_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<Envelope<T>> & { message?: string };
    if (!res.ok) throw new Error(`${method} ${path} said ${res.status}: ${json.error?.message ?? json.message ?? res.statusText}`);
    return json.data as T;
  }

  /** One activity on a session; `id` makes a retry return the stored row instead of a duplicate. */
  activity(agentSessionId: string, content: ActivityContent, extra: Record<string, unknown> = {}) {
    return this.rest("POST", "/agent/activities", { agentSessionId, content, id: crypto.randomUUID(), ...extra });
  }
  thought(sessionId: string, body: string, ephemeral = false) {
    return this.activity(sessionId, { type: "thought", body }, { ephemeral });
  }
  action(sessionId: string, action: string, parameter?: string, result?: string) {
    return this.activity(sessionId, { type: "action", action, parameter, result });
  }
  response(sessionId: string, body: string) {
    return this.activity(sessionId, { type: "response", body });
  }
  error(sessionId: string, body: string) {
    return this.activity(sessionId, { type: "error", body });
  }
  /** A question with buttons: the pick comes back as a `prompted` with trigger `card`. */
  select(sessionId: string, body: string, options: SelectOption[]) {
    return this.activity(sessionId, { type: "elicitation", body }, { signal: "select", signalMetadata: { options } });
  }
  /** The plan, the session's name and the links on its card. */
  update(sessionId: string, fields: { plan?: Array<{ content: string; status: "pending" | "inProgress" | "completed" | "canceled" }>; summary?: string | null; externalUrls?: Array<{ label: string; url: string }> }) {
    return this.rest("PATCH", `/agent/sessions/${sessionId}`, fields);
  }
  /** A session the agent opens itself on a task; nothing is sent back, it made it. */
  openOnIssue(issueId: string, externalUrls?: Array<{ label: string; url: string }>) {
    return this.rest<{ agentSession: { id: string } }>("POST", "/agent/sessions/on-issue", { issueId, externalUrls });
  }
  /** A session in a Pings conversation the agent is already in (its DM, a group it was called into, a team's Majlis). */
  openOnPing(pingThreadId: number) {
    return this.rest<{ agentSession: { id: string } }>("POST", "/agent/sessions/on-ping", { pingThreadId });
  }
  /** The agent's sessions that reached it, newest first: what to read after being down. */
  sessions(first = 50) {
    return this.rest<{ nodes: Array<{ id: string; status: string; issue: { identifier: string; title: string; description: string } | null }> }>("GET", `/agent/sessions?first=${first}`);
  }
  session(id: string) {
    return this.rest<{ agentSession: { id: string; status: string; activities: Array<{ type: string; userId: string | null }> } }>("GET", `/agent/sessions/${id}`);
  }

  /** A tool on the MCP server, as the agent. Returns the tool's structured result or its text. */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const token = await accessToken(this.env, this.organizationId);
    const res = await fetch(this.env.MUDEER_MCP, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const text = await res.text();
    // A JSON answer, or one event of an SSE stream.
    const line = /^(event|data):/.test(text) ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) : text;
    const json = JSON.parse(line ?? "{}") as { error?: { message: string }; result?: { isError?: boolean; structuredContent?: unknown; content?: Array<{ text?: string }> } };
    if (json.error) throw new Error(`${name}: ${json.error.message}`);
    const result = json.result ?? {};
    const asText = result.content?.map((c) => c.text ?? "").join("\n") ?? "";
    if (result.isError) throw new Error(`${name}: ${asText}`);
    return result.structuredContent ?? asText;
  }
}
