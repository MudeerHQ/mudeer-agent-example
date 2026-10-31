import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownReport } from "../src/lib/report.ts";

test("the report is a Markdown table with Western digits", () => {
  const md = markdownReport([{ label: "Active subscriptions", value: 1240 }, { label: "Churn", value: "2.1%" }], "2026-10-31");
  assert.match(md, /\*\*Daily report, 2026-10-31\*\*/);
  assert.match(md, /\| Active subscriptions \| 1,240 \|/);
  assert.match(md, /\| Churn \| 2.1% \|/);
});
