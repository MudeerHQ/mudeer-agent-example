// One run of the agent on a session: a first thought within seconds, then Claude with the tools,
// its text shown as thoughts and its calls as actions, and at the end a response, a question
// (ask_with_options), or an error. A stop, which arrives in another request, is a flag in KV the
// run reads before every tool call and before it answers (docs: /docs/agent-interaction,
// /docs/agent-signals, /docs/agent-best-practices).
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaTextBlock } from "@anthropic-ai/sdk/resources/beta/messages";
import { Mudeer } from "../mudeer.ts";
import type { AgentSessionEvent, Env } from "../types.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { StopRequested, toolsFor } from "./tools.ts";

const stopKey = (sessionId: string) => `stop:${sessionId}`;

export class AgentClient {
  private readonly env: Env;
  private readonly mudeer: Mudeer;
  private readonly claude: Anthropic | null;

  constructor(env: Env, organizationId: string) {
    this.env = env;
    this.mudeer = new Mudeer(env, organizationId);
    this.claude = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
  }

  /** A person pressed Stop, or removed the agent as delegate: the run sees the flag at its next step. */
  async stop(sessionId: string): Promise<void> {
    await this.env.STORE.put(stopKey(sessionId), "1", { expirationTtl: 60 * 60 });
    await this.mudeer.response(sessionId, "Stopped. Nothing more will be done here until someone asks again.");
  }

  private stopped(sessionId: string) {
    return async () => Boolean(await this.env.STORE.get(stopKey(sessionId)));
  }

  /** `created`: the task and the request; `prompted`: a follow-up, a pick, or a reply. */
  async run(event: AgentSessionEvent): Promise<void> {
    const sessionId = event.agentSession.id;
    const stopped = this.stopped(sessionId);
    await this.env.STORE.delete(stopKey(sessionId)); // a new request lifts an old stop
    // First, within 10 seconds: this is what tells Mudeer, and the person, that the work was received.
    await this.mudeer.thought(sessionId, event.action === "created" ? "Reading the task…" : "Reading your message…", true);
    try {
      if (event.action === "created") {
        await this.mudeer.update(sessionId, {
          plan: [
            { content: "Read the task and the request", status: "inProgress" },
            { content: "Do the work", status: "pending" },
            { content: "Report back", status: "pending" },
          ],
        });
      }
      const answer = await this.think(event, stopped);
      if (await stopped()) return;
      if (answer === null) return; // a question was asked; the turn ends there
      if (event.action === "created") {
        await this.mudeer.update(sessionId, {
          plan: [
            { content: "Read the task and the request", status: "completed" },
            { content: "Do the work", status: "completed" },
            { content: "Report back", status: "completed" },
          ],
        });
      }
      await this.mudeer.response(sessionId, answer);
    } catch (error) {
      if (error instanceof StopRequested || (await stopped())) return;
      await this.mudeer.error(sessionId, `Something went wrong on my side: ${(error as Error).message}`).catch(() => {});
    }
  }

  /** The model's answer, or null when it asked a question instead. */
  private async think(event: AgentSessionEvent, stopped: () => Promise<boolean>): Promise<string | null> {
    const sessionId = event.agentSession.id;
    const request = userMessage(event);
    if (!this.claude) return echo(event, request); // no ANTHROPIC_API_KEY: the shape without the model

    const state = { asked: false, stopped };
    const tools = toolsFor(this.mudeer, sessionId, state);
    const messages: BetaMessageParam[] = [{ role: "user", content: request }];
    const runner = this.claude.beta.messages.toolRunner({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      max_iterations: 12,
      output_config: { effort: "medium" },
      // A policy decline is answered by a fallback model instead of ending the run.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    let last = "";
    for await (const message of runner) {
      const text = message.content
        .filter((b): b is BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (message.stop_reason === "tool_use") {
        // Words before a call are the agent's thoughts, shown as it works.
        if (text) await this.mudeer.thought(sessionId, text, true);
      } else {
        last = text;
      }
      if (state.asked) break;
    }
    if (state.asked) return null;
    return last || "I have nothing to add.";
  }
}

/** The task and the request as the model reads them: Mudeer's promptContext when there is one. */
function userMessage(event: AgentSessionEvent): string {
  const body = event.agentActivity?.content.body ?? "";
  if (event.action === "created") return event.promptContext ?? body ?? "A task was handed to you. Read it with get_task and report.";
  const who = event.agentActivity?.user?.name;
  // A pick from ask_with_options arrives as the option's label (trigger `card`).
  if (event.trigger === "card") return `The person chose: ${body}`;
  return who ? `${who} wrote: ${body}` : body;
}

/** Without a model key the agent still answers, so the webhook and the routes can be tried. */
function echo(event: AgentSessionEvent, request: string): string {
  const title = event.agentSession.task?.title;
  return [
    title ? `I read **${title}**.` : "I read the request.",
    `You asked:\n\n> ${request.replace(/\n/g, "\n> ")}`,
    "Set `ANTHROPIC_API_KEY` and I will actually work on it.",
  ].join("\n\n");
}
