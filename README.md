# Mudeer agent example

> **بالعربي باختصار:** وكيل مثال لمدير، بلا أي اعتمادية: يستقبل ويب هوك مدير ويتحقق من توقيعه، يردّ خلال ثوانٍ بفكرة، يقرأ المهمة عبر خادم MCP بنفس التوكن، يكتب خطته على بطاقة الجلسة، ويختم بردّ أو خطأ. يتوقف فورًا عند `stop`، ويعرف كيف يسأل بخيارات. في `examples/daily-report` وكيل ثانٍ ينشر كل صباح تقرير أرقام من Metabase أو Amplitude في سلسلة مهمة. استبدل `work()` بعملك وعندك وكيل.

The smallest agent that does everything Mudeer expects of one, in plain Node with no dependencies.
It is the companion of [Mudeer's docs](https://mudeer.co/en/docs): read
[Build your agent](https://mudeer.co/en/docs/agents) first, then follow the code.

What it does, and where:

| Step | File |
| --- | --- |
| Verifies `Mudeer-Signature` on the raw body, checks `webhookTimestamp`, skips a retried `Mudeer-Delivery` | `src/verify.js` |
| Answers the webhook with 200 within 5 seconds, then works | `src/server.js` |
| Posts a `thought` within 10 seconds, a `plan` on the card, a `response` or an `error` at the end | `src/agent.js` |
| Stops at once on `signal: "stop"`, even mid-run | `src/agent.js` |
| Reads the task through the MCP server (`get_task`) with its own token | `src/mudeer.js` |
| Trades the install's code for tokens, refreshes them, one workspace per install | `src/tokens.js` |
| Opens a session itself and posts a daily report of your numbers | `examples/daily-report/` |

## Run it

1. In Mudeer, as a workspace admin: **Settings › API › Applications › New application**. Give it a
   name, the callback URL `https://<your-host>/oauth/callback`, enable the webhook with the URL
   `https://<your-host>/webhook`, and enable client credentials. Copy the client id, the client
   secret and the webhook secret.
2. `cp .env.example .env` and fill them in. `PORT` is 8787 unless you say otherwise.
3. `npm start`. Expose it on HTTPS (a tunnel does for development: `cloudflared tunnel --url
   http://localhost:8787`, or `ngrok http 8787`), and put that host in the Application and in
   `MUDEER_REDIRECT_URI`.
4. Open `https://<your-host>/install` and approve the install as the admin. The agent is now a
   member of the workspace; give it Team access where it should take work.
5. Delegate a task to it, or mention it in a comment. Within a few seconds its card shows
   "Reading the task…", then the plan, then the answer.

`npm test` runs the verification tests. There is nothing else to install.

## Make it yours

`work()` in `src/agent.js` is where the agent does what it does: call your model, your CI, your
database. Keep the shape around it: the first thought early, the plan honest, the response or
error at the end, the stop obeyed. The rules it is held to are in
[How an agent should behave](https://mudeer.co/en/docs/agent-guidelines) and
[Before you ship](https://mudeer.co/en/docs/agent-best-practices).

More ideas in the same shape:

- **Daily numbers** (`examples/daily-report`): Metabase or Amplitude → a report in a task's thread
  every morning.
- **Release notes**: when a release's tasks are all done, draft the notes and ask with `select`
  which tone to use.
- **Triage**: on a new task in the triage queue, read it, propose a team and a priority as options,
  apply the pick.
- **Support digest**: read yesterday's tasks labelled `support`, summarise the themes, post them.

## Where to read more

- [Build your agent](https://mudeer.co/en/docs/agents), [Developing the agent interaction](https://mudeer.co/en/docs/agent-interaction), [Agent signals](https://mudeer.co/en/docs/agent-signals)
- [MCP server](https://mudeer.co/en/docs/mcp), [Webhooks](https://mudeer.co/en/docs/webhooks), [OAuth 2.0 authentication](https://mudeer.co/en/docs/oauth-2-0-authentication), [Rate limiting](https://mudeer.co/en/docs/rate-limiting)

MIT licensed.
