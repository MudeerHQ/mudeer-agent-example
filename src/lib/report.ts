// A proactive agent: every weekday morning it reads the numbers from your analytics (Metabase or
// Amplitude), opens a session on a task of your choice, and posts the report there, so the task's
// thread is the team's daily feed. Nothing here is specific to analytics: `readMetrics` is the
// only place that knows the source.
import { Mudeer } from "./mudeer.ts";
import { installedWorkspaces } from "./oauth.ts";
import type { Env } from "./types.ts";

interface Metric {
  label: string;
  value: number | string;
}

/** Metabase: a saved question's rows, by its card id, with an API key (Settings › Authentication › API keys). */
async function fromMetabase(env: Env): Promise<Metric[]> {
  const res = await fetch(`${env.METABASE_URL!.replace(/\/$/, "")}/api/card/${env.METABASE_CARD_ID}/query/json`, {
    method: "POST",
    headers: { "x-api-key": env.METABASE_API_KEY!, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Metabase said ${res.status}`);
  const rows = (await res.json()) as Array<Record<string, unknown>>; // [{ metric: "Active subscriptions", value: 1240 }, …]
  return rows.map((row) => ({ label: String(row.metric ?? row.name ?? Object.values(row)[0]), value: (row.value ?? Object.values(row)[1]) as number | string }));
}

/** Amplitude: yesterday's totals of the events you name, through the Dashboard REST API. */
async function fromAmplitude(env: Env): Promise<Metric[]> {
  const auth = btoa(`${env.AMPLITUDE_API_KEY}:${env.AMPLITUDE_SECRET_KEY}`);
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const events = (env.AMPLITUDE_EVENTS ?? "Subscription Started,Subscription Cancelled").split(",").map((s) => s.trim());
  const out: Metric[] = [];
  for (const name of events) {
    const q = new URLSearchParams({ e: JSON.stringify({ event_type: name }), start: day, end: day });
    const res = await fetch(`https://amplitude.com/api/2/events/segmentation?${q}`, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`Amplitude said ${res.status} for ${name}`);
    const data = (await res.json()) as { data?: { series?: number[][] } };
    out.push({ label: name, value: data.data?.series?.[0]?.reduce((a, b) => a + b, 0) ?? 0 });
  }
  return out;
}

function readMetrics(env: Env): Promise<Metric[]> {
  if (env.REPORT_SOURCE === "metabase") return fromMetabase(env);
  if (env.REPORT_SOURCE === "amplitude") return fromAmplitude(env);
  throw new Error(`REPORT_SOURCE is metabase or amplitude, not "${env.REPORT_SOURCE}"`);
}

/** The report as Markdown: a table people scan in the thread, Western digits in both languages. */
export function markdownReport(metrics: Metric[], date: string): string {
  const fmt = new Intl.NumberFormat("en-US");
  const rows = metrics.map((m) => `| ${m.label} | ${typeof m.value === "number" ? fmt.format(m.value) : m.value} |`).join("\n");
  return `**Daily report, ${date}**\n\n| Metric | Value |\n| --- | ---: |\n${rows}`;
}

/**
 * Posts today's report in every workspace the agent is installed in: in a task's thread
 * (REPORT_TASK), or straight into a Pings conversation the agent is in (REPORT_PING_THREAD: a
 * group the team called it into, or a team's Majlis). Off while both are empty.
 */
export async function dailyReport(env: Env): Promise<void> {
  if (!env.REPORT_TASK && !env.REPORT_PING_THREAD) return;
  const date = new Date().toISOString().slice(0, 10);
  for (const organizationId of await installedWorkspaces(env)) {
    const mudeer = new Mudeer(env, organizationId);
    const { agentSession } = env.REPORT_PING_THREAD
      ? await mudeer.openOnPing(Number(env.REPORT_PING_THREAD))
      : await mudeer.openOnIssue(env.REPORT_TASK!, [{ label: "Source", url: env.METABASE_URL ?? "https://amplitude.com" }]);
    await mudeer.thought(agentSession.id, "Reading today's numbers…", true);
    try {
      await mudeer.response(agentSession.id, markdownReport(await readMetrics(env), date));
    } catch (error) {
      await mudeer.error(agentSession.id, `Couldn't read the numbers today: ${(error as Error).message}`);
    }
  }
}
