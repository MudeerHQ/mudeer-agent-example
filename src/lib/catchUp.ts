// Every hour: the sessions that reached the agent while it was down or failing. A session the
// agent never spoke on is answered now, from what the session itself says about its task.
import { AgentClient } from "./agent/agentClient.ts";
import { Mudeer } from "./mudeer.ts";
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
      const issue = node.issue;
      const event = {
        type: "AgentSessionEvent",
        action: "created",
        trigger: "retry",
        organizationId,
        agentSession: { id: node.id, issue },
        agentActivity: null,
        promptContext: issue ? `<issue identifier="${issue.identifier}"><title>${issue.title}</title><description>${issue.description}</description></issue>` : undefined,
      } as unknown as AgentSessionEvent;
      await new AgentClient(env, organizationId).run(event);
    }
  }
}
