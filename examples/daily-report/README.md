# Daily report

A proactive agent: it opens a session on a task every morning and posts the day's numbers there,
so the task's thread is the team's daily feed. Two sources are wired, Metabase (a saved question)
and Amplitude (event totals); `readMetrics` is the only place that knows them.

```sh
# Metabase
METABASE_URL=https://metabase.example METABASE_API_KEY=mb_… METABASE_CARD_ID=42 \
REPORT_SOURCE=metabase REPORT_TASK=OPS-12 MUDEER_WORKSPACE=acme npm run report

# Amplitude
AMPLITUDE_API_KEY=… AMPLITUDE_SECRET_KEY=… AMPLITUDE_EVENTS="Subscription Started,Subscription Cancelled" \
REPORT_SOURCE=amplitude REPORT_TASK=OPS-12 MUDEER_WORKSPACE=acme npm run report
```

`MUDEER_WORKSPACE` is the workspace the agent was installed in (the key `data/tokens.json` holds
after an install), or anything when `MUDEER_AGENT_TOKEN` is set. Schedule it with cron
(`0 6 * * 1-5`), a GitHub Actions `schedule`, or whatever runs your jobs.

What it uses from Mudeer: `POST /agent/sessions/on-issue` to open the session, then a `thought`
and a `response` (or an `error`) on it, the same activities an agent answers a delegation with.
See [Developing the agent interaction](https://mudeer.co/en/docs/agent-interaction).
