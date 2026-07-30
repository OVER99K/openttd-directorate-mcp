import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayResponse, OpenTtdGateway } from "../gateway/types.js";
import {
  applySchema,
  chatSchema,
  commissionSchema,
  executeSchema,
  observeSchema,
  planSchema,
  rconSchema,
  verifySchema,
  type ApplyInput,
  type ChatInput,
  type CommissionInput,
  type ExecuteInput,
  type ObserveInput,
  type PlanInput,
  type RconInput,
  type VerifyInput,
} from "./schemas.js";

export interface ToolHandlers {
  observe(input: ObserveInput): Promise<CallToolResult>;
  plan(input: PlanInput): Promise<CallToolResult>;
  apply(input: ApplyInput): Promise<CallToolResult>;
  commission(input: CommissionInput): Promise<CallToolResult>;
  verify(input: VerifyInput): Promise<CallToolResult>;
  execute(input: ExecuteInput): Promise<CallToolResult>;
  chat(input: ChatInput): Promise<CallToolResult>;
  rcon(input: RconInput): Promise<CallToolResult>;
}

export function createToolHandlers(gateway: OpenTtdGateway, maxResultBytes = 1024 * 1024): ToolHandlers {
  const render = (response: GatewayResponse): CallToolResult => toResult(response, maxResultBytes);
  return {
    async observe(input) {
      return render(await gateway.observe(observeSchema.parse(input)));
    },
    async plan(input) {
      return render(await gateway.plan(planSchema.parse(input)));
    },
    async apply(input) {
      return render(await gateway.apply(applySchema.parse(input)));
    },
    async commission(input) {
      const request = commissionSchema.parse(input);
      const response = await gateway.execute({
        command: "commission_route",
        company_id: request.company_id,
        params: { plan_id: request.plan_id, route_id: request.route_id, cargo_label: request.cargo_label },
      });
      return render({ ...response, payload: { commissioned: response.ok, request, response: response.payload } });
    },
    async verify(input) {
      const request = verifySchema.parse(input);
      const response = await gateway.verify(request);
      return render({ ...response, payload: { requested_level: request.level, response: response.payload } });
    },
    async execute(input) {
      return render(await gateway.execute(executeSchema.parse(input)));
    },
    async chat(input) {
      return render(await gateway.chat(chatSchema.parse(input)));
    },
    async rcon(input) {
      return render(await gateway.rcon(rconSchema.parse(input)));
    },
  };
}

function toResult(value: GatewayResponse, maxResultBytes: number): CallToolResult {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > maxResultBytes) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ correlation_id: value.correlation_id, ok: false, error: "tool_result_too_large" }) }],
    };
  }
  return {
    isError: !value.ok,
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}
