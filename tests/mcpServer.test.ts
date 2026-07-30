import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { GatewayResponse, OpenTtdGateway } from "../src/gateway/types.js";
import { createMcpServer } from "../src/mcp/server.js";

test("MCP server lists the bounded Directorate surface and dispatches a tool", async () => {
  const calls: { name: string; request: unknown }[] = [];
  const gateway: OpenTtdGateway = {
    observe: async (request) => record("observe", request),
    plan: async (request) => record("plan", request),
    apply: async (request) => record("apply", request),
    verify: async (request) => record("verify", request),
    execute: async (request) => record("execute", request),
    chat: async (request) => record("chat", request),
    rcon: async (request) => record("rcon", request),
  };
  const server = createMcpServer(gateway);
  const client = new Client({ name: "directorate-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["apply", "chat", "commission", "execute", "observe", "plan", "rcon", "verify"],
    );

    const observeResult = await client.callTool({ name: "observe", arguments: { scope: "map", limit: 7 } });
    assert.equal(observeResult.isError, false);
    assert.deepEqual(calls, [{ name: "observe", request: { scope: "map", limit: 7 } }]);

    const commissionResult = await client.callTool({ name: "commission", arguments: { company_id: 0, plan_id: "p1", route_id: "r1" } });
    assert.equal(commissionResult.isError, false);
    assert.deepEqual(calls.slice(1), [{ name: "execute", request: { command: "commission_route", company_id: 0, params: { plan_id: "p1", route_id: "r1", cargo_label: undefined } } }]);
  } finally {
    await client.close();
    await server.close();
  }

  function record(name: string, request: unknown): Promise<GatewayResponse> {
    calls.push({ name, request });
    return Promise.resolve({ correlation_id: `${name}-mcp`, ok: true, payload: { echoed: request } });
  }
});
