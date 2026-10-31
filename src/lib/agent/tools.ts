// The tools the model may call, each bound to the session it works on. Reads go through
// Mudeer's MCP server with the agent's own token (the same get_task and list_comments people's
// AI apps call); every call is shown on the card as an action, with its result.
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { Mudeer } from "../mudeer.ts";

export class StopRequested extends Error {
  constructor() {
    super("stop requested");
  }
}

export function toolsFor(mudeer: Mudeer, sessionId: string, state: { asked: boolean; stopped: () => Promise<boolean> }) {
  const guard = async () => {
    if (await state.stopped()) throw new StopRequested();
  };
  const shown = async (action: string, parameter: string, work: () => Promise<unknown>): Promise<string> => {
    await guard();
    const result = await work();
    const text = typeof result === "string" ? result : JSON.stringify(result);
    await mudeer.action(sessionId, action, parameter, text.length > 2000 ? `${text.slice(0, 2000)}…` : text);
    return text;
  };

  return [
    betaTool({
      name: "get_task",
      description: "The task whole: title, description, status, assignee, delegate, labels, dates.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The task's identifier, such as ENG-42, or its id." } },
        required: ["id"],
        additionalProperties: false,
      } as const,
      run: ({ id }) => shown("get_task", id, () => mudeer.tool("get_task", { id })),
    }),
    betaTool({
      name: "list_comments",
      description: "The task's thread, oldest first.",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string", description: "The task's identifier or id." } },
        required: ["taskId"],
        additionalProperties: false,
      } as const,
      run: ({ taskId }) => shown("list_comments", taskId, () => mudeer.tool("list_comments", { taskId })),
    }),
    betaTool({
      name: "ask_with_options",
      description:
        "Ask the person to choose, when the request could mean more than one thing. Draws the options as buttons and ends your turn; the pick arrives as the next message. Use it once, with 2 to 5 options.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" } }, required: ["value"], additionalProperties: false },
          },
        },
        required: ["question", "options"],
        additionalProperties: false,
      } as const,
      run: async ({ question, options }) => {
        await guard();
        await mudeer.select(sessionId, question, options);
        state.asked = true;
        return "The question is posted. Stop here: say nothing more, the person's choice will arrive as the next message.";
      },
    }),
  ];
}
