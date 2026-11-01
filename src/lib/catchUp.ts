// Every hour: the sessions that reached the agent while it was down or failing. A session the
// agent never spoke on is answered now, from what the session itself says about its task.
import { AgentClient } from "./agent/agentClient.ts";
import { Mudeer, type SessionNode } from "./mudeer.ts";
import { installedWorkspaces } from "./oauth.ts";
import type { AgentSessionEvent, Env } from "./types.ts";

export async function catchUp(env: Env): Promise<void> {
  for (const organizationId of await installedWorkspaces(env)) {
    const mudeer = new Mudeer(env, organizationId);
    const { nodes } = await mudeer.sessions(50);
    for (const node of nodes.filter((n) => n.status === "pending")) {
      const { agentSession } = await mudeer.session(node.id);
      // The agent's own activities carry no userId; one means the session was answered.
      if (agentSession.activities.some((a) => a.type !== "prompt" && a.userId === null)) continue;
      await new AgentClient(env, organizationId).run(catchUpEvent(organizationId, node));
    }
  }
}

/** A session found by the catch-up, as the `created` event it would have been, from what `GET /agent/sessions` says of its task. */
export function catchUpEvent(organizationId: string, node: SessionNode): AgentSessionEvent {
  const task = node.task;
  return {
    type: "AgentSessionEvent",
    action: "created",
    trigger: "retry",
    organizationId,
    agentSession: { id: node.id, taskId: node.taskId, task },
    agentActivity: null,
    promptContext: task ? `<task identifier="${task.identifier}"><title>${task.title}</title><description>${task.description}</description></task>` : undefined,
  } as unknown as AgentSessionEvent;
}
