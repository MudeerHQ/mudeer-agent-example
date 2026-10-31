# Mudeer agent example

> **بالعربي باختصار:** وكيل مثال لمدير على Cloudflare Workers، مثل مثال لينير. يستقبل ويب هوك مدير ويتحقق من توقيعه ويردّ خلال ثوانٍ، ثم يشتغل بـ Claude بأدوات مدير عبر خادم MCP (يقرأ المهمة وسلسلتها)، يعرض أفكاره وأفعاله على بطاقة الجلسة، يسأل بخيارات لما يلتبس الطلب، ويختم بردّ أو خطأ. يتوقف فورًا عند `stop` حتى أثناء التنفيذ، ويلحق بالجلسات اللي فاتته كل ساعة، وينشر كل صباح تقرير أرقام من Metabase أو Amplitude في سلسلة مهمة. غيّر `prompt.ts` و`tools.ts` وعندك وكيلك.

The whole of what Mudeer expects of an agent, on Cloudflare Workers with Claude, as
[Linear's weather-bot](https://github.com/linear/weather-bot) is for Linear. It is the companion of
[Mudeer's docs](https://mudeer.co/en/docs): read [Build your agent](https://mudeer.co/en/docs/agents)
first, then follow the code.

| What | Where |
| --- | --- |
| Verifies `Mudeer-Signature` on the raw body (Web Crypto), checks `webhookTimestamp`, skips a retried `Mudeer-Delivery` (KV) | `src/lib/verify.ts` |
| Answers the webhook with 200 at once, works in `ctx.waitUntil` | `src/index.ts` |
| A `thought` within seconds, the `plan` on the card, Claude with tools, a `response` or an `error` | `src/lib/agent/agentClient.ts` |
| The tools: `get_task` and `list_comments` over Mudeer's MCP server, `ask_with_options` (a `select` elicitation) | `src/lib/agent/tools.ts` |
| What the agent is told it is | `src/lib/agent/prompt.ts` |
| Stops on `signal: "stop"`, even mid-run (a flag in KV read before every step) | `agentClient.ts` |
| The install, tokens per workspace in KV, refresh, `OAuthApp revoked` forgets them | `src/lib/oauth.ts` |
| Every hour: sessions missed while down (`GET /agent/sessions`) are answered | `src/lib/catchUp.ts` |
| Every weekday morning: a report of your numbers in a task's thread (`POST /agent/sessions/on-issue`) | `src/lib/report.ts` |
| The event and activity shapes | `src/lib/types.ts` |

## Run it

You need a Cloudflare account, a Mudeer workspace where you are an admin, and an Anthropic API
key (optional: without it the agent still answers, echoing the request, so the wiring can be tried).

1. `npm install`, then `npx wrangler login`.
2. `npx wrangler kv namespace create STORE` and put the id it prints in `wrangler.jsonc`.
3. In Mudeer: **Settings › API › Applications › New application**. Callback URL
   `https://<your-worker>/oauth/callback`; webhook on, URL `https://<your-worker>/webhook`, with
   agent session events; copy the client id, the client secret and the webhook secret.
4. `wrangler.jsonc`: `MUDEER_CLIENT_ID` and `WORKER_URL`. Secrets:
   ```sh
   npx wrangler secret put MUDEER_CLIENT_SECRET
   npx wrangler secret put MUDEER_WEBHOOK_SECRET
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
5. `npm run deploy`. For local work, `cp .dev.vars.example .dev.vars`, fill it, `npm run dev`, and
   point the Application at a tunnel to it.
6. Open `https://<your-worker>/install` and approve the install as the admin. The agent is now a
   member of the workspace; give it Team access where it should take work.
7. Delegate a task to it, or mention it in a comment or a Pings message. Its card shows "Reading
   the task…", its thoughts and tool calls, then the answer.

`npm run typecheck` and `npm test` are what CI runs.

## Make it yours

- `src/lib/agent/prompt.ts` is who the agent is. `src/lib/agent/tools.ts` is what it can do: add a
  tool that calls your CI, your database, your API, in the same shape, and it shows on the card as
  an action.
- The model is Claude Opus 5.5 through the Anthropic SDK's tool runner, with the server-side
  fallback on, so a policy decline is answered by another model instead of ending the run. Turn it
  off by removing `fallbacks` in `agentClient.ts`.
- Keep the shape around the model: the first thought early, the plan honest, a response or an
  error at the end, the stop obeyed. The rules it is held to are in
  [How an agent should behave](https://mudeer.co/en/docs/agent-guidelines) and
  [Before you ship](https://mudeer.co/en/docs/agent-best-practices).

### The daily report

Set `REPORT_TASK` (the task whose thread receives it, `OPS-12`) and `REPORT_SOURCE` (`metabase` or
`amplitude`) in `wrangler.jsonc`, the source's secrets (`.dev.vars.example` lists them), and the
cron in `triggers` does the rest, in every workspace the agent is installed in. `readMetrics` in
`src/lib/report.ts` is the only place that knows the source: swap it for a database, a sheet,
your own API.

More in the same shape: release notes drafted when a release's tasks are all done, with
`ask_with_options` for the tone; triage that proposes a team and a priority as options and applies
the pick; a support digest of yesterday's `support` tasks.

## Where to read more

[Build your agent](https://mudeer.co/en/docs/agents) · [Developing the agent interaction](https://mudeer.co/en/docs/agent-interaction) · [Agent signals](https://mudeer.co/en/docs/agent-signals) · [MCP server](https://mudeer.co/en/docs/mcp) · [Webhooks](https://mudeer.co/en/docs/webhooks) · [OAuth 2.0](https://mudeer.co/en/docs/oauth-2-0-authentication) · [Rate limiting](https://mudeer.co/en/docs/rate-limiting)

MIT licensed.
