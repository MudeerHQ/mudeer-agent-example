// A proactive agent: every morning it reads the numbers from your analytics (Metabase or
// Amplitude), opens a session on a task of your choice, and posts the report there, so the
// task's thread becomes the team's daily feed. Run it from cron, GitHub Actions or any scheduler:
//
//   REPORT_TASK=OPS-12 REPORT_SOURCE=metabase node examples/daily-report/report.js
//
// It needs the agent installed in the workspace (or MUDEER_AGENT_TOKEN), and the task in a team
// the agent may take work in. Nothing here is specific to analytics: swap `readMetrics` for any
// source (a database, a spreadsheet, your own API) and the rest stands.
import { Mudeer } from "../../src/mudeer.js";
import "../../src/config.js";

const env = (name, fallback) => process.env[name] ?? fallback;

/** Metabase: a saved question's rows, by its card id, with an API key (Settings › Authentication › API keys). */
async function fromMetabase() {
  const base = env("METABASE_URL").replace(/\/$/, "");
  const res = await fetch(`${base}/api/card/${env("METABASE_CARD_ID")}/query/json`, {
    method: "POST",
    headers: { "x-api-key": env("METABASE_API_KEY"), "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Metabase said ${res.status}`);
  const rows = await res.json(); // [{ metric: "Active subscriptions", value: 1240 }, …]
  return rows.map((row) => ({ label: String(row.metric ?? row.name ?? Object.values(row)[0]), value: row.value ?? Object.values(row)[1] }));
}

/** Amplitude: yesterday's totals of the events you name, through the Dashboard REST API. */
async function fromAmplitude() {
  const auth = Buffer.from(`${env("AMPLITUDE_API_KEY")}:${env("AMPLITUDE_SECRET_KEY")}`).toString("base64");
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const events = env("AMPLITUDE_EVENTS", "Subscription Started,Subscription Cancelled").split(",");
  const out = [];
  for (const name of events) {
    const q = new URLSearchParams({ e: JSON.stringify({ event_type: name.trim() }), start: day, end: day });
    const res = await fetch(`https://amplitude.com/api/2/events/segmentation?${q}`, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`Amplitude said ${res.status} for ${name}`);
    const data = await res.json();
    out.push({ label: name.trim(), value: data.data?.series?.[0]?.reduce((a, b) => a + b, 0) ?? 0 });
  }
  return out;
}

async function readMetrics() {
  const source = env("REPORT_SOURCE", "metabase");
  if (source === "metabase") return fromMetabase();
  if (source === "amplitude") return fromAmplitude();
  throw new Error(`REPORT_SOURCE is metabase or amplitude, not ${source}`);
}

/** The report as Markdown: a table people scan in the thread, Western digits in both languages. */
function markdown(metrics, date) {
  const fmt = new Intl.NumberFormat("en-US");
  const rows = metrics.map((m) => `| ${m.label} | ${typeof m.value === "number" ? fmt.format(m.value) : m.value} |`).join("\n");
  return `**Daily report, ${date}**\n\n| Metric | Value |\n| --- | ---: |\n${rows}`;
}

async function main() {
  const mudeer = new Mudeer(env("MUDEER_WORKSPACE", "default"));
  const issueId = env("REPORT_TASK");
  if (!issueId) throw new Error("Set REPORT_TASK to the task's identifier (OPS-12) that holds the daily reports");
  const date = new Date().toISOString().slice(0, 10);

  const { agentSession } = await mudeer.openOnIssue(issueId, [{ label: "Source", url: env("REPORT_SOURCE_URL", env("METABASE_URL", "https://amplitude.com")) }]);
  await mudeer.thought(agentSession.id, "Reading today's numbers…", true);
  try {
    const metrics = await readMetrics();
    await mudeer.response(agentSession.id, markdown(metrics, date));
  } catch (error) {
    await mudeer.error(agentSession.id, `Couldn't read the numbers today: ${error.message}`);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
