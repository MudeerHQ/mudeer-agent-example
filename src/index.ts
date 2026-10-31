// The Worker: Mudeer's webhook at POST /webhook, the install at GET /install and its return at
// GET /oauth/callback, and two schedules, the daily report and the hourly catch-up. The webhook
// is answered at once and the work goes on in ctx.waitUntil, so Mudeer always hears 200 within
// its 5 seconds (docs: /docs/webhooks).
import { AgentClient } from "./lib/agent/agentClient.ts";
import { catchUp } from "./lib/catchUp.ts";
import { forgetWorkspace, handleCallback, handleInstall } from "./lib/oauth.ts";
import { dailyReport } from "./lib/report.ts";
import type { AgentSessionEvent, AppEvent, Env } from "./lib/types.ts";
import { firstDelivery, isFresh, verifySignature } from "./lib/verify.ts";

async function onEvent(event: AppEvent, env: Env): Promise<void> {
  switch (event.type) {
    case "AgentSessionEvent": {
      const session = event as AgentSessionEvent;
      const agent = new AgentClient(env, session.organizationId);
      if (session.agentActivity?.signal === "stop") return agent.stop(session.agentSession.id);
      return agent.run(session);
    }
    case "OAuthApp":
      // The workspace revoked the install: its tokens are gone, and nothing more reaches it.
      if (event.action === "revoked") await forgetWorkspace(env, event.organizationId);
      return;
    case "PermissionChange":
    case "AppUserNotification":
      // Team access changed, or the agent was mentioned somewhere without a session: worth a log.
      console.log(`${event.type}/${event.action} in ${event.organizationId}`);
      return;
    default:
      console.log(`Unhandled event ${event.type}/${event.action}`);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/webhook") {
      const raw = await request.text();
      if (!(await verifySignature(raw, request.headers.get("mudeer-signature"), env.MUDEER_WEBHOOK_SECRET))) return new Response(null, { status: 401 });
      let event: AppEvent;
      try {
        event = JSON.parse(raw) as AppEvent;
      } catch {
        return new Response(null, { status: 400 });
      }
      if (!isFresh(event.webhookTimestamp)) return new Response(null, { status: 401 });
      // 200 now; the work after. A retry of a delivery already handled is acknowledged and skipped.
      if (await firstDelivery(env.STORE, request.headers.get("mudeer-delivery"))) {
        ctx.waitUntil(onEvent(event, env).catch((error) => console.error("event failed", error)));
      }
      return new Response(null, { status: 200 });
    }
    if (request.method === "GET" && url.pathname === "/install") return handleInstall(env);
    if (request.method === "GET" && url.pathname === "/oauth/callback") return handleCallback(request, env);
    if (url.pathname === "/health") return new Response("ok");
    return new Response("Mudeer agent example. Open /install to add it to a workspace.", { status: 200 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(controller.cron === "0 6 * * 1-5" ? dailyReport(env) : catchUp(env));
  },
} satisfies ExportedHandler<Env>;
