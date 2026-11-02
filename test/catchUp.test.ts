import { test } from "node:test";
import assert from "node:assert/strict";
import { catchUpEvent } from "../src/lib/catchUp.ts";

test("a missed session's event carries its task as GET /agent/sessions answers it (taskId, task, <task>)", () => {
  const node = {
    id: "s1",
    status: "pending",
    taskId: "t1",
    task: { id: "t1", identifier: "ENG-42", title: "Checkout fails", description: "Steps…" },
  };
  const event = catchUpEvent("acme", node as never);
  assert.equal(event.agentSession.task?.identifier, "ENG-42");
  assert.equal(
    event.promptContext,
    '<task identifier="ENG-42"><title>Checkout fails</title><description>Steps…</description></task>',
  );
});

test("a session with no task (a Pings conversation) has no promptContext", () => {
  const event = catchUpEvent("acme", { id: "s2", status: "pending", taskId: null, task: null } as never);
  assert.equal(event.promptContext, undefined);
});
