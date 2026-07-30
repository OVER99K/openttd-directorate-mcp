import { AdminClient } from "./admin/client.js";
import { parseEnv, redactedConfig } from "./config/env.js";
import { AdminOpenTtdGateway } from "./gateway/adminGateway.js";
import { serveStdio } from "./mcp/server.js";

const config = parseEnv(process.env);

if (config.mcp.transport !== "stdio") {
  throw new Error("Streamable HTTP is intentionally left behind a config seam until bearer auth, CORS, and DNS rebinding controls are complete.");
}

console.error(JSON.stringify({ level: "info", message: "starting", config: redactedConfig(config) }));

const client = new AdminClient(config.admin);
const gateway = new AdminOpenTtdGateway(client);
await serveStdio(gateway);
