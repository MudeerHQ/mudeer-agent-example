// Reads .env (if present) and the environment. No dependency: the file is KEY=value lines.
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // No .env: the environment alone.
}

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} (see .env.example)`);
  return value;
};

export const config = {
  clientId: process.env.MUDEER_CLIENT_ID ?? "",
  clientSecret: process.env.MUDEER_CLIENT_SECRET ?? "",
  webhookSecret: () => need("MUDEER_WEBHOOK_SECRET"),
  redirectUri: process.env.MUDEER_REDIRECT_URI ?? "",
  agentToken: process.env.MUDEER_AGENT_TOKEN ?? "",
  api: (process.env.MUDEER_API ?? "https://api.mudeer.co").replace(/\/$/, ""),
  mcp: process.env.MUDEER_MCP ?? "https://mcp.mudeer.co/mcp",
  app: (process.env.MUDEER_APP ?? "https://app.mudeer.co").replace(/\/$/, ""),
  port: Number(process.env.PORT ?? 8787),
};
