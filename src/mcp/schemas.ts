import { z } from "zod";
import type { ApplyRequest, ChatRequest, CommissionRequest, ExecuteRequest, ObserveRequest, PlanRequest, RconRequest, VerifyRequest } from "../gateway/types.js";

const boundedId = z.string().min(1).max(128);
const boundedOperationId = z.string().min(1).max(96).regex(/^[A-Za-z0-9_.:-]+$/);
const companyId = z.number().int().min(0).max(254);
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue).max(128), z.record(jsonValue)]),
);
const jsonObject = z.record(jsonValue);

export const observeSchema = z
  .object({
    scope: z.enum(["map", "company", "plans", "routes", "economy"]),
    company_id: companyId.optional(),
    route_id: boundedId.optional(),
    limit: z.number().int().min(1).max(256).default(64),
  })
  .strict();

export const planSchema = z
  .object({
    intent: jsonObject,
    company_id: companyId,
    policy: jsonObject.default({}),
    plan_id: boundedId.optional(),
    revision: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const path of findForbiddenPlanningPaths({ intent: value.intent, policy: value.policy })) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Normal planning rejects tile-list/path inputs; provide intent and constraints instead.",
        path,
      });
    }
  });

export const applySchema = z
  .object({
    company_id: companyId,
    plan_id: boundedId,
    revision: z.number().int().min(0),
    phase: z.enum(["preflight", "commit", "rollback"]),
    operation_id: boundedOperationId,
    target_operation_id: boundedOperationId.optional(),
    reserve: z.number().int().min(0).max(10_000_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.phase === "rollback" && value.target_operation_id === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target_operation_id"], message: "rollback requires target_operation_id" });
    }
    if (value.phase === "rollback" && value.target_operation_id === value.operation_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operation_id"], message: "rollback operation_id must be distinct from target_operation_id" });
    }
  });

export const verifySchema = z
  .object({
    company_id: companyId,
    route_id: boundedId.optional(),
    plan_id: boundedId.optional(),
    operation_id: boundedOperationId.optional(),
    level: z.enum(["topology", "commissioning", "economic"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const provided = [value.route_id, value.plan_id, value.operation_id].filter((item) => item !== undefined);
    if (provided.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["route_id"],
        message: "verify requires exactly one of route_id, plan_id, or operation_id",
      });
    }
  });

export const commissionSchema = z
  .object({
    company_id: companyId,
    plan_id: boundedId,
    route_id: boundedId,
    cargo_label: z.string().min(0).max(8).optional(),
  })
  .strict();

export const executeSchema = z
  .object({
    command: boundedId,
    company_id: companyId,
    params: jsonObject.default({}),
  })
  .strict();

export const chatSchema = z
  .object({
    message: z.string().min(1).max(1024),
  })
  .strict();

export const rconSchema = z
  .object({
    command: z.string().min(1).max(1024),
  })
  .strict();

export type ObserveInput = z.infer<typeof observeSchema> & ObserveRequest;
export type PlanInput = z.infer<typeof planSchema> & PlanRequest;
export type ApplyInput = z.infer<typeof applySchema> & ApplyRequest;
export type VerifyInput = z.infer<typeof verifySchema> & VerifyRequest;
export type CommissionInput = z.infer<typeof commissionSchema> & CommissionRequest;
export type ExecuteInput = z.infer<typeof executeSchema> & ExecuteRequest;
export type ChatInput = z.infer<typeof chatSchema> & ChatRequest;
export type RconInput = z.infer<typeof rconSchema> & RconRequest;

const forbiddenPlanningKeys = new Set(["tile", "tiles", "tile_list", "tileList", "path", "waypoints", "route_tiles"]);

function findForbiddenPlanningPaths(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenPlanningPaths(item, [...path, index]));
  }
  if (!isRecord(value)) return [];
  const found: (string | number)[][] = [];
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (forbiddenPlanningKeys.has(key)) found.push(nextPath);
    found.push(...findForbiddenPlanningPaths(child, nextPath));
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
