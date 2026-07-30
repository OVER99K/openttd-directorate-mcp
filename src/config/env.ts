import { z } from "zod";
import type { AdminClientOptions } from "../admin/client.js";

export type McpTransportMode = "stdio" | "streamable_http";

export interface AppConfig {
  readonly admin: AdminClientOptions;
  readonly mcp: {
    readonly transport: McpTransportMode;
    readonly bindHost: string;
    readonly port: number;
    readonly bearerTokenSet: boolean;
  };
}

const envSchema = z.object({
  OPENTTD_ADMIN_HOST: z.string().min(1).default("127.0.0.1"),
  OPENTTD_ADMIN_PORT: intString(1, 65535).default("3977"),
  OPENTTD_ADMIN_PASSWORD: z.string().default(""),
  OPENTTD_ADMIN_NAME: z.string().min(1).max(128).default("OpenTTD Directorate MCP"),
  OPENTTD_ADMIN_VERSION: z.string().min(1).max(64).default("0.1.0"),
  MCP_TRANSPORT: z.enum(["stdio", "streamable_http"]).default("stdio"),
  MCP_BIND_HOST: z.string().min(1).default("127.0.0.1"),
  MCP_PORT: intString(1, 65535).default("8797"),
  MCP_BEARER_TOKEN: z.string().default(""),
  OPENTTD_REQUEST_TIMEOUT_MS: intString(100, 120000).default("15000"),
  OPENTTD_CONNECT_TIMEOUT_MS: intString(100, 120000).default("10000"),
  OPENTTD_PING_INTERVAL_MS: z.union([z.literal("0").transform(() => 0), intString(1000, 300000)]).default("30000"),
  OPENTTD_MAX_PACKET_BYTES: intString(128, 32767).default("1460"),
  OPENTTD_MAX_BUFFERED_BYTES: intString(128, 1048576).default("65536"),
  OPENTTD_MAX_RESPONSE_BYTES: intString(128, 16 * 1024 * 1024).default("1048576"),
  OPENTTD_MAX_RESPONSE_CHUNKS: intString(1, 1024).default("64"),
  OPENTTD_MAX_PENDING_REQUESTS: intString(1, 256).default("32"),
  OPENTTD_RECONNECT: z.enum(["true", "false"]).default("true"),
  OPENTTD_RECONNECT_MAX_ATTEMPTS: intString(0, 100).default("5"),
  OPENTTD_RECONNECT_INITIAL_DELAY_MS: intString(10, 60000).default("500"),
  OPENTTD_RECONNECT_MAX_DELAY_MS: intString(10, 300000).default("10000"),
});

export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    admin: {
      host: parsed.OPENTTD_ADMIN_HOST,
      port: parsed.OPENTTD_ADMIN_PORT,
      password: parsed.OPENTTD_ADMIN_PASSWORD,
      name: parsed.OPENTTD_ADMIN_NAME,
      version: parsed.OPENTTD_ADMIN_VERSION,
      requestTimeoutMs: parsed.OPENTTD_REQUEST_TIMEOUT_MS,
      connectTimeoutMs: parsed.OPENTTD_CONNECT_TIMEOUT_MS,
      pingIntervalMs: parsed.OPENTTD_PING_INTERVAL_MS,
      reconnect: {
        enabled: parsed.OPENTTD_RECONNECT === "true",
        maxAttempts: parsed.OPENTTD_RECONNECT_MAX_ATTEMPTS,
        initialDelayMs: parsed.OPENTTD_RECONNECT_INITIAL_DELAY_MS,
        maxDelayMs: parsed.OPENTTD_RECONNECT_MAX_DELAY_MS,
      },
      codec: {
        maxPacketBytes: parsed.OPENTTD_MAX_PACKET_BYTES,
        maxBufferedBytes: parsed.OPENTTD_MAX_BUFFERED_BYTES,
        maxStringBytes: parsed.OPENTTD_MAX_PACKET_BYTES,
      },
      maxResponseBytes: parsed.OPENTTD_MAX_RESPONSE_BYTES,
      maxResponseChunks: parsed.OPENTTD_MAX_RESPONSE_CHUNKS,
      maxPendingRequests: parsed.OPENTTD_MAX_PENDING_REQUESTS,
    },
    mcp: {
      transport: parsed.MCP_TRANSPORT,
      bindHost: parsed.MCP_BIND_HOST,
      port: parsed.MCP_PORT,
      bearerTokenSet: parsed.MCP_BEARER_TOKEN.length > 0,
    },
  };
}

export function redactedConfig(config: AppConfig): Omit<AppConfig, "admin"> & { readonly admin: Omit<AdminClientOptions, "password"> & { readonly passwordSet: boolean } } {
  const { password, ...admin } = config.admin;
  return { ...config, admin: { ...admin, passwordSet: password.length > 0 } };
}

function intString(min: number, max: number): z.ZodEffects<z.ZodString, number, string> {
  return z.string().transform((value, ctx) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max || parsed.toString() !== value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Expected integer string between ${min} and ${max}` });
      return z.NEVER;
    }
    return parsed;
  });
}
