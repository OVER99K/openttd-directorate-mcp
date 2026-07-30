import assert from "node:assert/strict";
import test from "node:test";
import { createToolHandlers } from "../src/mcp/handlers.js";
import { applySchema, commissionSchema, observeSchema, planSchema, verifySchema } from "../src/mcp/schemas.js";
import type { GatewayResponse, OpenTtdGateway } from "../src/gateway/types.js";

test("plan schema rejects tile-list/path inputs", () => {
  assert.equal(
    planSchema.safeParse({ company_id: 1, intent: { cargo: "coal", path: [1, 2, 3] }, policy: {} }).success,
    false,
  );
});

test("apply schema requires durable operation ids and rollback target ids", () => {
  assert.equal(applySchema.safeParse({ company_id: 1, plan_id: "p1", revision: 1, phase: "commit" }).success, false);
  assert.equal(
    applySchema.safeParse({ company_id: 1, plan_id: "p1", revision: 1, phase: "rollback", operation_id: "same", target_operation_id: "same" }).success,
    false,
  );
  assert.equal(
    applySchema.safeParse({ company_id: 1, plan_id: "p1", revision: 1, phase: "rollback", operation_id: "rb.1", target_operation_id: "commit.1" }).success,
    true,
  );
});

test("tool handlers forward exact typed requests and preserve verify level", async () => {
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
  const handlers = createToolHandlers(gateway);
  await handlers.observe({ scope: "map", limit: 3 });
  await handlers.plan({ company_id: 2, intent: { cargo: "coal" }, policy: { max_cost: 10 } });
  await handlers.apply({ company_id: 2, plan_id: "p1", revision: 4, phase: "preflight", operation_id: "tools.preflight.1" });
  const commissionResult = await handlers.commission({ company_id: 2, plan_id: "p1", route_id: "r1", cargo_label: "COAL" });
  const verifyResult = await handlers.verify({ company_id: 2, route_id: "r1", level: "economic" });
  await handlers.execute({ company_id: 2, command: "diagnose", params: { x: 1 } });
  const chatResult = await handlers.chat({ message: "hello" });
  await handlers.rcon({ command: "status" });

  assert.deepEqual(calls.map((call) => call.name), ["observe", "plan", "apply", "execute", "verify", "execute", "chat", "rcon"]);
  assert.deepEqual(calls[1]?.request, { company_id: 2, intent: { cargo: "coal" }, policy: { max_cost: 10 } });
  assert.deepEqual(calls[3]?.request, { command: "commission_route", company_id: 2, params: { plan_id: "p1", route_id: "r1", cargo_label: "COAL" } });
  assert.match(commissionResult.content[0]?.type === "text" ? commissionResult.content[0].text : "", /"commissioned":true/);
  assert.match(verifyResult.content[0]?.type === "text" ? verifyResult.content[0].text : "", /"requested_level":"economic"/);
  assert.equal(chatResult.isError, true);

  const boundedHandlers = createToolHandlers(gateway, 64);
  const oversizedResult = await boundedHandlers.observe({ scope: "map", limit: 3 });
  assert.equal(oversizedResult.isError, true);
  assert.match(oversizedResult.content[0]?.type === "text" ? oversizedResult.content[0].text : "", /tool_result_too_large/);

  function record(name: string, request: unknown): Promise<GatewayResponse> {
    calls.push({ name, request });
    return Promise.resolve({ correlation_id: `${name}-1`, ok: name !== "chat", payload: { echoed: request } });
  }
});

test("commission schema validates company/plan/route and bounded cargo label", () => {
  assert.equal(commissionSchema.safeParse({ company_id: 0, plan_id: "p1", route_id: "r1" }).success, true);
  assert.equal(
    commissionSchema.safeParse({ company_id: 0, plan_id: "p1", route_id: "r1", cargo_label: "PASSENGER" }).success,
    false,
  );
  assert.equal(commissionSchema.safeParse({ company_id: 1, route_id: "r1" }).success, false);
});

test("observe schema exposes persisted plans through the typed MCP surface", () => {
  assert.equal(observeSchema.safeParse({ scope: "plans", route_id: "p1" }).success, true);
});

test("verify schema requires route_id, plan_id, or operation_id", () => {
  assert.equal(verifySchema.safeParse({ company_id: 1, level: "topology" }).success, false);
  assert.equal(verifySchema.safeParse({ company_id: 1, route_id: "r1", plan_id: "p1", level: "topology" }).success, false);
  assert.equal(verifySchema.safeParse({ company_id: 1, route_id: "r1", level: "economic" }).success, true);
  assert.equal(verifySchema.safeParse({ company_id: 1, plan_id: "p1", level: "commissioning" }).success, true);
  assert.equal(verifySchema.safeParse({ company_id: 1, operation_id: "op1", level: "topology" }).success, true);
});
