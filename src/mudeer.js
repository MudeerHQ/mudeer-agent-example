// What the agent says to Mudeer: activities and the session's plan and links over REST, and reads
// over the MCP server with the same token, the same tools people's AI apps use
// (docs: /docs/agent-interaction, /docs/mcp).
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { accessToken } from "./tokens.js";

async function rest(organizationId, method, path, body) {
  const token = await accessToken(organizationId);
  const res = await fetch(`${config.api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} said ${res.status}: ${json.error?.message ?? json.message ?? res.statusText}`);
  return json.data;
}

export class Mudeer {
  constructor(organizationId) {
    this.organizationId = organizationId;
  }

  /** One activity on a session; `id` makes a retry return the stored row instead of a duplicate. */
  activity(agentSessionId, content, extra = {}) {
    return rest(this.organizationId, "POST", "/agent/activities", { agentSessionId, content, id: randomUUID(), ...extra });
  }
  thought(sessionId, body, ephemeral = false) {
    return this.activity(sessionId, { type: "thought", body }, { ephemeral });
  }
  action(sessionId, action, parameter, result) {
    return this.activity(sessionId, { type: "action", action, parameter, result });
  }
  response(sessionId, body) {
    return this.activity(sessionId, { type: "response", body });
  }
  error(sessionId, body) {
    return this.activity(sessionId, { type: "error", body });
  }
  /** A question with buttons: the pick comes back as a `prompted` with trigger `card`. */
  select(sessionId, body, options) {
    return this.activity(sessionId, { type: "elicitation", body }, { signal: "select", signalMetadata: { options } });
  }
  /** The plan, the session's name and the links on its card. */
  update(sessionId, fields) {
    return rest(this.organizationId, "PATCH", `/agent/sessions/${sessionId}`, fields);
  }
  /** A comment on a task, as the agent, in a thread when `parentId` names one. */
  comment(issueId, body, parentId) {
    return rest(this.organizationId, "POST", "/agent/comments", { issueId, body, parentId, id: randomUUID() });
  }
  /** A session the agent opens itself on a task (nothing is sent back: it made it). */
  openOnIssue(issueId, externalUrls) {
    return rest(this.organizationId, "POST", "/agent/sessions/on-issue", { issueId, externalUrls });
  }
  /** The agent's sessions that reached it, newest first: what to read after being down. */
  sessions(first = 50) {
    return rest(this.organizationId, "GET", `/agent/sessions?first=${first}`);
  }

  /** A tool on the MCP server, as the agent. Returns the tool's structured result or its text. */
  async tool(name, args = {}) {
    const token = await accessToken(this.organizationId);
    const res = await fetch(config.mcp, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const text = await res.text();
    // A JSON answer, or one event of an SSE stream.
    const line = text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) : text;
    const json = JSON.parse(line ?? "{}");
    if (json.error) throw new Error(`${name}: ${json.error.message}`);
    const result = json.result ?? {};
    if (result.isError) throw new Error(`${name}: ${result.content?.map((c) => c.text).join("\n")}`);
    return result.structuredContent ?? result.content?.map((c) => c.text).join("\n") ?? "";
  }
}
