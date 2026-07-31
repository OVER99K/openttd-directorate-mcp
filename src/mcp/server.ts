import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { OpenTtdGateway } from "../gateway/types.js";
import { createToolHandlers } from "./handlers.js";
import {
  applyToolSchema,
  chatSchema,
  commissionSchema,
  executeSchema,
  observeSchema,
  planToolSchema,
  rconSchema,
  verifyToolSchema,
} from "./schemas.js";

export function createMcpServer(gateway: OpenTtdGateway): McpServer {
  const server = new McpServer({
    name: "openttd-directorate-mcp",
    version: "0.1.0",
  });
  const handlers = createToolHandlers(gateway);
  server.registerTool("observe", { inputSchema: observeSchema }, (input) => handlers.observe(input));
  server.registerTool("plan", { inputSchema: planToolSchema }, (input) => handlers.plan(input));
  server.registerTool("apply", { inputSchema: applyToolSchema }, (input) => handlers.apply(input));
  server.registerTool("commission", { inputSchema: commissionSchema }, (input) => handlers.commission(input));
  server.registerTool("verify", { inputSchema: verifyToolSchema }, (input) => handlers.verify(input));
  server.registerTool("execute", { inputSchema: executeSchema }, (input) => handlers.execute(input));
  server.registerTool("chat", { inputSchema: chatSchema }, (input) => handlers.chat(input));
  server.registerTool("rcon", { inputSchema: rconSchema }, (input) => handlers.rcon(input));
  return server;
}

export async function serveStdio(gateway: OpenTtdGateway): Promise<void> {
  const server = createMcpServer(gateway);
  await server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 1024 * 1024 }));
}
