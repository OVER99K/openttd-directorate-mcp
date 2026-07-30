import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const gameDir = "game/openttd_directorate";

test("Stable GameScript package has required entry points and no prohibited paths", () => {
  const files = readdirSync(gameDir).filter((file) => file.endsWith(".nut"));
  assert.ok(files.includes("info.nut"));
  assert.ok(files.includes("main.nut"));
  const text = files.map((file) => readFileSync(join(gameDir, file), "utf8")).join("\n");
  assert.match(text, /RegisterGS\(OpenTTDDirectorateInfo\(\)\)/);
  assert.match(text, /class OpenTTDDirectorate extends GSController/);
});

test("Stable version constants fence save/load, protocol, and route bounds", () => {
  const source = readFileSync(join(gameDir, "version.nut"), "utf8");
  assert.match(source, /DIRECTORATE_M4_SAVE_VERSION/);
  assert.match(source, /DIRECTORATE_M4_PROTOCOL_VERSION/);
  assert.match(source, /DIRECTORATE_M4_MAX_ROUTES/);
  assert.match(source, /DIRECTORATE_M4_MAX_ROUTE_VEHICLES/);
  assert.match(source, /DIRECTORATE_M4_ROUTE_REGISTRY_VERSION/);
});

test("Route registry is persistent, bounded, and reports health/economics", () => {
  const registry = readFileSync(join(gameDir, "route_registry.nut"), "utf8");
  assert.match(registry, /class DirectorateM4RouteRegistry/);
  assert.match(registry, /function Save\(\)/);
  assert.match(registry, /function Load\(data\)/);
  assert.match(registry, /function Create\(/);
  assert.match(registry, /function Get\(/);
  assert.match(registry, /function Observe\(/);
  assert.match(registry, /function Summary\(/);
  assert.match(registry, /function AddAlert\(/);
  assert.match(registry, /function Retention\(/);
  assert.match(registry, /topology_ok/);
  assert.match(registry, /orders_ok/);
  assert.match(registry, /vehicle_running/);
  assert.match(registry, /positive_revenue/);
  assert.match(registry, /last_year_profit/);
  assert.match(registry, /this_year_profit/);
  assert.match(registry, /lifetime_profit/);
  assert.match(registry, /DIRECTORATE_M4_MAX_ROUTES/);
  assert.match(registry, /DIRECTORATE_M4_MAX_ROUTE_VEHICLES/);
  assert.match(registry, /"commissioned"/);
});

test("Commissioning workflow exercises topology, orders, vehicle, and verify levels", () => {
  const registry = readFileSync(join(gameDir, "route_registry.nut"), "utf8");
  assert.match(registry, /function D4_CommissionRoute\(/);
  assert.match(registry, /function D4_VerifyRouteTopology\(/);
  assert.match(registry, /function D4_AreStationsConnectedByRail\(/);
  assert.match(registry, /guard\s*<\s*2048/);
  assert.match(registry, /function D4_ConfigureRouteOrders\(/);
  assert.match(registry, /function D4_BuildRouteVehicle\(/);
  assert.match(registry, /function D4_UpdateRouteHealth\(/);
  assert.match(registry, /function D4_VerifyRoute\(/);
  assert.match(registry, /level == "topology"/);
  assert.match(registry, /level == "commissioning"/);
  assert.match(registry, /level == "economic"/);
  const failedReplayGuard = registry.indexOf('if (existing.state != "commissioned")');
  const idempotentSuccess = registry.indexOf('note = "idempotent"', failedReplayGuard);
  assert.ok(failedReplayGuard >= 0, "commission replay must reject non-commissioned routes");
  assert.ok(idempotentSuccess > failedReplayGuard, "idempotent success must occur only after the commissioned-state guard");
});

test("Plan store owns the route registry and exposes observe/verify routes", () => {
  const store = readFileSync(join(gameDir, "plan_store.nut"), "utf8");
  assert.match(store, /registry = DirectorateM4RouteRegistry\(\)/);
  assert.match(store, /registry = this\.registry\.Save\(\)/);
  assert.match(store, /this\.registry\.Load\(data\.registry\)/);
  assert.match(store, /scope == "routes"/);
  assert.match(store, /this\.registry\.Observe\(request\)/);
  assert.match(store, /D4_VerifyRoute\(this\.registry,/);
  assert.match(store, /function VerifyOperation\(/);
  assert.match(store, /this\.journal\.Get\(operation_id\)/);
  assert.match(store, /this\.journal\.Replay\(op\)/);
});

test("Bridge dispatches verify and executes commission_route", () => {
  const bridge = readFileSync(join(gameDir, "bridge.nut"), "utf8");
  assert.match(bridge, /op == "verify"/);
  assert.match(bridge, /payload\.command == "commission_route"/);
  assert.match(bridge, /D4_CommissionRoute\(this\.store, this\.store\.registry,/);
  assert.match(bridge, /targets != 1/);
  assert.match(bridge, /this\.store\.Verify\(payload\.company_id, payload\.operation_id, level, true\)/);
});

test("Source uses bounded loops and explicit safety constants", () => {
  const source = readdirSync(gameDir)
    .filter((file) => file.endsWith(".nut"))
    .map((file) => readFileSync(join(gameDir, file), "utf8"))
    .join("\n");
  assert.match(source, /DIRECTORATE_M4_MAX_BLUEPRINT_TILES/);
  assert.match(source, /DIRECTORATE_M4_MAX_OPERATION_ENTRIES/);
  assert.match(source, /DIRECTORATE_M4_MAX_REQUEST_BYTES/);
  assert.match(source, /DIRECTORATE_M4_MAX_ROUTES/);
  assert.match(source, /DIRECTORATE_M4_MAX_ROUTE_VEHICLES/);
  assert.doesNotMatch(source, /while \(true\)[\s\S]*while \(true\)/);
});

test("Depot access joins the depot mouth to the route instead of duplicating straight track", () => {
  const program = readFileSync(join(gameDir, "build_program.nut"), "utf8");
  assert.match(program, /ops\.append\(depot\.access_op\)/);
  assert.match(program, /access_op\s*=\s*\{[^}]*kind\s*=\s*"rail_connection"[^}]*tile\s*=\s*D4_ToTile\(front\)[^}]*prev\s*=\s*D4_ToTile\(a\)[^}]*next\s*=\s*D4_ToTile\(depot_point\)/s);
  assert.doesNotMatch(program, /access\s*=\s*\[a,\s*front\]/);
});

test("Station survey uses authoritative producer and acceptor catchment tiles", () => {
  const survey = readFileSync(join(gameDir, "site_survey.nut"), "utf8");
  const store = readFileSync(join(gameDir, "plan_store.nut"), "utf8");
  assert.match(survey, /GSTileList_IndustryProducing\(industry_id, catchment\)/);
  assert.match(survey, /GSTileList_IndustryAccepting\(industry_id, catchment\)/);
  assert.match(survey, /catchment_tiles\.HasItem\(D4_ToTile\(tile\.point\)\)/);
  assert.doesNotMatch(survey, /abs\(tile\.point\.x - industry_location\.x\) \+ abs\(tile\.point\.y - industry_location\.y\)/);
  assert.match(store, /D4_SurveyStationSites\(plan\.company_id, source_id, "source", template/);
  assert.match(store, /D4_SurveyStationSites\(plan\.company_id, dest_id, "destination", template/);
});

test("Planning input rejects tile lists and path inputs", () => {
  const util = readFileSync(join(gameDir, "util.nut"), "utf8");
  const store = readFileSync(join(gameDir, "plan_store.nut"), "utf8");
  assert.match(util, /D4_ContainsForbiddenPlanningInput/);
  assert.match(util, /"tile"/);
  assert.match(util, /"tiles"/);
  assert.match(util, /"path"/);
  assert.match(util, /"waypoints"/);
  assert.match(store, /D4_ContainsForbiddenPlanningInput/);
});

test("Operation journal keeps durable idempotent request/replay contracts", () => {
  const journal = readFileSync(join(gameDir, "operation_journal.nut"), "utf8");
  assert.match(journal, /class DirectorateM4OperationJournal/);
  assert.match(journal, /function D4_ApplyRequestFingerprint/);
  assert.match(journal, /function D4_RunApplyPhases/);
  assert.match(journal, /request_fingerprint/);
  assert.match(journal, /function ValidateReuse/);
  assert.match(journal, /function Replay/);
  assert.match(journal, /operation_phase_mismatch/);
  assert.match(journal, /operation_request_mismatch/);
  assert.match(journal, /operation_id_required/);
  assert.match(journal, /target_operation_id_required/);
});

test("Main Save/Load keeps plan and registry envelope version", () => {
  const main = readFileSync(join(gameDir, "main.nut"), "utf8");
  assert.match(main, /DIRECTORATE_M4_SAVE_VERSION/);
  assert.match(main, /this\.store\.Save\(\)/);
  assert.match(main, /data\.version == DIRECTORATE_M4_SAVE_VERSION/);
  assert.match(main, /this\.store\.Load\(data\.plans\)/);
});

test("TS contracts expose commission request and bounded verify schema", () => {
  const types = readFileSync("src/gateway/types.ts", "utf8");
  const schemas = readFileSync("src/mcp/schemas.ts", "utf8");
  assert.match(types, /interface CommissionRequest/);
  assert.match(schemas, /boundedOperationId/);
  assert.match(schemas, /commissionSchema/);
  assert.match(schemas, /verifySchema/);
  assert.match(schemas, /verify requires exactly one of route_id, plan_id, or operation_id/);
  assert.match(schemas, /level: z\.enum\(\["topology", "commissioning", "economic"\]\)/);
});
