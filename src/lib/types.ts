// What Mudeer sends and what the Worker is configured with (docs: /docs/agent-interaction).

export interface Env {
  STORE: KVNamespace;
  MUDEER_CLIENT_ID: string;
  MUDEER_CLIENT_SECRET: string;
  MUDEER_WEBHOOK_SECRET: string;
  ANTHROPIC_API_KEY?: string;
  WORKER_URL: string;
  MUDEER_API: string;
  MUDEER_MCP: string;
  MUDEER_APP: string;
  REPORT_TASK?: string;
  /** Instead of a task: the Pings conversation (its id) the report goes to; the agent must be in it. */
  REPORT_PING_THREAD?: string;
  REPORT_SOURCE?: "metabase" | "amplitude" | "";
  METABASE_URL?: string;
  METABASE_API_KEY?: string;
  METABASE_CARD_ID?: string;
  AMPLITUDE_API_KEY?: string;
  AMPLITUDE_SECRET_KEY?: string;
  AMPLITUDE_EVENTS?: string;
}

/** Every event an installed Application receives carries these. */
export interface AppEvent {
  type: "AgentSessionEvent" | "AppUserNotification" | "PermissionChange" | "OAuthApp" | string;
  action: string;
  createdAt: string;
  organizationId: string;
  oauthClientId: string;
  appUserId: string;
  webhookId: string;
  webhookTimestamp: number;
}

/** `descriptionMention`: the agent named in the task's description, a delegation-shaped session. */
export type Trigger = "delegation" | "mention" | "descriptionMention" | "reply" | "card" | "stop" | "undelegation" | "ping" | "retry";

export interface AgentSessionEvent extends AppEvent {
  type: "AgentSessionEvent";
  action: "created" | "prompted";
  trigger: Trigger;
  agentSession: {
    id: string;
    appUserId: string;
    organizationId: string;
    status: "pending" | "active" | "error" | "awaitingInput" | "complete" | "stale";
    type: string;
    summary: string | null;
    creatorId: string | null;
    creator: { id: string; name: string; email: string | null; avatarUrl: string | null; url: string | null } | null;
    taskId: string | null;
    task: {
      id: string;
      identifier: string;
      title: string;
      description: string;
      url: string;
      teamId: string | null;
      team: { id: string; key: string; name: string } | null;
    } | null;
    commentId: string | null;
    url: string;
  };
  agentActivity: {
    id: string;
    agentSessionId: string;
    content: { type: "prompt"; body: string };
    signal: "stop" | null;
    signalMetadata: Record<string, unknown> | null;
    sourceCommentId: string | null;
    userId: string | null;
    user: { id: string; name: string } | null;
    createdAt: string;
  } | null;
  /** On `created`: the task and the request, as XML the model reads whole. */
  promptContext?: string;
  guidance: string[];
}

export type ActivityContent =
  | { type: "thought" | "elicitation" | "response" | "error"; body: string }
  | { type: "action"; action: string; parameter?: string; result?: string };

export interface SelectOption {
  value: string;
  label?: string;
}

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  expiresAt: number;
  scope?: string;
}
