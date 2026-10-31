// What the agent does with each event. This one reads the task, says what it will do, and answers
// with a short summary; a real agent puts its own work where `work()` is. The shape is what
// matters: a thought within 10 seconds, a plan on the card, a response or an error at the end, a
// stop obeyed at once (docs: /docs/agent-interaction, /docs/agent-signals, /docs/agent-best-practices).
import { Mudeer } from "./mudeer.js";

const running = new Map(); // sessionId → AbortController, so a stop reaches a run in progress

export async function handle(event) {
  if (event.type !== "AgentSessionEvent") return; // OAuthApp revoked, PermissionChange, …: log and move on
  const session = event.agentSession;
  const mudeer = new Mudeer(event.organizationId);
  const prompt = event.agentActivity;

  if (prompt?.signal === "stop") {
    running.get(session.id)?.abort();
    running.delete(session.id);
    await mudeer.response(session.id, "Stopped. Nothing more will be done on this task until someone asks again.");
    return;
  }

  const controller = new AbortController();
  running.set(session.id, controller);
  try {
    if (event.action === "created") await onCreated(mudeer, event, controller.signal);
    else if (event.action === "prompted") await onPrompted(mudeer, event, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return; // a stop already answered
    await mudeer.error(session.id, `Something went wrong on my side: ${error.message}`).catch(() => {});
  } finally {
    if (running.get(session.id) === controller) running.delete(session.id);
  }
}

async function onCreated(mudeer, event, signal) {
  const { agentSession: session, trigger } = event;
  // First, within 10 seconds: this is what tells Mudeer, and the person, that the work was received.
  await mudeer.thought(session.id, trigger === "delegation" ? "Reading the task…" : "Reading the thread…", true);

  // The task, whole, through the MCP server (the same get_task people's AI apps call).
  const task = session.issue ? await mudeer.tool("get_task", { id: session.issue.identifier }) : null;
  const request = event.promptContext ?? event.agentActivity?.content?.body ?? "";

  await mudeer.update(session.id, {
    plan: [
      { content: "Read the task and the request", status: "completed" },
      { content: "Do the work", status: "inProgress" },
      { content: "Report back", status: "pending" },
    ],
  });

  const result = await work({ task, request, signal });
  if (signal.aborted) return;

  await mudeer.update(session.id, {
    plan: [
      { content: "Read the task and the request", status: "completed" },
      { content: "Do the work", status: "completed" },
      { content: "Report back", status: "completed" },
    ],
  });
  await mudeer.response(session.id, result);
}

async function onPrompted(mudeer, event, signal) {
  const { agentSession: session, trigger } = event;
  const text = event.agentActivity?.content?.body ?? "";
  await mudeer.thought(session.id, "Reading your reply…", true);
  // A pick from a `select` arrives as the option's label (or its value when that is a link).
  const picked = trigger === "card" ? text.trim() : null;
  const result = await work({ task: null, request: text, picked, signal });
  if (!signal.aborted) await mudeer.response(session.id, result);
}

/** Your agent's real work goes here. This example only echoes what it understood. */
async function work({ task, request, picked, signal }) {
  await new Promise((r) => setTimeout(r, 300)); // stands in for the model call
  if (signal.aborted) return "";
  if (picked) return `Got it: **${picked}**. Reply here if you want something else.`;
  const title = task?.title ?? task?.name ?? (typeof task === "string" ? task.split("\n")[0] : null);
  return [
    title ? `I read **${title}**.` : "I read the request.",
    request ? `You asked:\n\n> ${request.replace(/\n/g, "\n> ")}` : "",
    "Replace `work()` in `src/agent.js` with what your agent does, and you have an agent.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
