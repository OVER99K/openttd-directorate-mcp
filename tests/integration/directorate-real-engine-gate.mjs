#!/usr/bin/env node
import { accessSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createToolHandlers } from "../../dist/src/mcp/handlers.js";
import { AdminOpenTtdGateway } from "../../dist/src/gateway/adminGateway.js";
import { AdminClient } from "../../dist/src/admin/client.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next documented location.
    }
  }
  return null;
}

function firstDirectory(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

const pathOpenTtd = firstExecutable((process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "openttd")));
const openttd = firstExecutable([
  process.env.OPENTTD_15_BIN,
  pathOpenTtd,
  "/tmp/ottd153/openttd-15.3-linux-generic-amd64/openttd",
]);
if (openttd === null) throw new Error("OpenTTD 15.3 not found; set OPENTTD_15_BIN or add openttd to PATH");
const versionProbe = spawnSync(openttd, ["-v"], { encoding: "utf8" });
const openttdVersion = `${versionProbe.stdout ?? ""}\n${versionProbe.stderr ?? ""}`.match(/^OpenTTD [^\r\n]+/m)?.[0] ?? "unknown";
if (!/^OpenTTD 15\.3(?:\s|$)/.test(openttdVersion)) throw new Error(`OpenTTD 15.3 required, got: ${openttdVersion}`);

const openGfx = firstDirectory([
  process.env.OPENTTD_OPENGFX_DIR,
  "/usr/share/games/openttd/baseset/opengfx",
  join(homedir(), ".local/share/openttd/baseset/opengfx"),
]);
if (openGfx === null) throw new Error("OpenGFX directory not found; set OPENTTD_OPENGFX_DIR");
const port = Number.parseInt(process.env.OPENTTD_DIRECTORATE_GATE_PORT ?? "4004", 10);
const gamePort = Number.parseInt(process.env.OPENTTD_DIRECTORATE_GAME_PORT ?? String(port + 1), 10);
const password = "test-directorate";
const fixture = mkdtempSync(join(tmpdir(), "openttd-directorate-gate-"));
const logPath = join(fixture, "openttd.log");
const evidencePath = process.env.OPENTTD_GATE_EVIDENCE_PATH ?? join(tmpdir(), `openttd-directorate-gate-${createHash("sha1").update(fixture).digest("hex").slice(0, 12)}.json`);
let serverRun = 0;

function writeConfig() {
  mkdirSync(join(fixture, "game"), { recursive: true });
  mkdirSync(join(fixture, "ai/directorate_gate_fixture"), { recursive: true });
  mkdirSync(join(fixture, "baseset"), { recursive: true });

  cpSync(join(repoRoot, "game/openttd_directorate"), join(fixture, "game/openttd_directorate"), { recursive: true });
  const fixtureBridgePath = join(fixture, "game/openttd_directorate/bridge.nut");
  const fixtureBridge = readFileSync(fixtureBridgePath, "utf8");
  const migrationProbe = `\t\tif (payload.command == "signal_api_probe") {
\t\t\tlocal mode = GSCompanyMode(payload.company_id);
\t\t\tif (!GSCompanyMode.IsValid() || !D4_SelectRailType()) return { ok = false, error = D4_Error("probe_company_mode_failed", payload.company_id.tostring()) };
\t\t\tlocal plan = this.store.GetPlan(payload.params.plan_id);
\t\t\tif (plan == null || !D4_Has(plan, "build_program")) return { ok = false, error = D4_Error("probe_plan_missing", payload.params.plan_id) };
\t\t\tforeach (op in plan.build_program.ops) {
\t\t\t\tif (!D4_IsTable(op) || !D4_Has(op, "kind") || op.kind != "rail_connection") continue;
\t\t\t\tif (!GSRail.BuildSignal(op.tile, op.prev, GSRail.SIGNALTYPE_PBS_ONEWAY)) continue;
\t\t\t\tlocal signal_type = GSRail.GetSignalType(op.tile, op.prev);
\t\t\t\tlocal removed = signal_type == GSRail.SIGNALTYPE_PBS_ONEWAY && GSRail.RemoveSignal(op.tile, op.prev);
\t\t\t\treturn { ok = signal_type == GSRail.SIGNALTYPE_PBS_ONEWAY && removed, payload = { tile = op.tile, front = op.prev, signal_type = signal_type, removed = removed } };
\t\t\t}
\t\t\treturn { ok = false, error = D4_Error("probe_signal_unbuildable", "") };
\t\t}
\t\tif (payload.command == "migration_safety_probe") {
\t\t\tlocal original = this.store.GetPlan(payload.params.plan_id);
\t\t\tif (original == null) return { ok = false, error = D4_Error("probe_plan_missing", payload.params.plan_id) };
\t\t\tlocal empty_path = { revision = 0, state = "ready", station_blueprint = original.station_blueprint, build_program = { ok = true, version = 1, ops = original.build_program.ops, path = [] } };
\t\t\tlocal malformed_ops = { revision = 0, state = "ready", station_blueprint = original.station_blueprint, build_program = { ok = true, version = 1, ops = [{}], path = original.build_program.path } };
\t\t\tlocal missing_revision = { state = "ready", station_blueprint = original.station_blueprint, build_program = { ok = true, version = 1, ops = original.build_program.ops, path = original.build_program.path } };
\t\t\tlocal results = [D4_UpgradeBuildProgram(empty_path), D4_UpgradeBuildProgram(malformed_ops), D4_UpgradeBuildProgram(missing_revision)];
return { ok = true, payload = { all_rejected = !results[0] && !results[1] && !results[2], results = results } };
}
if (payload.command == "load_budget_probe_seed") {
local source_op = this.store.journal.Get("directorate-gate.commit");
if (source_op == null || source_op.entries.len() < 1) return { ok = false, error = { code = "probe_source_missing", detail = "completed operation journal missing" } };
local entries = [];
for (local i = 0; i < 111; i++) {
	local source_entry = source_op.entries[i % source_op.entries.len()];
	entries.append({ kind = "reused", tile = source_entry.tile, detail = source_entry.detail, tick = source_entry.tick });
}
local ids = ["directorate-gate.partial-a", "directorate-gate.partial-b"];
local states = ["failed_partial", "rollback_partial"];
for (local i = 0; i < ids.len(); i++) {
	local op = { operation_id = ids[i], company_id = 0, plan_id = "directorate-gate-plan", revision = 4, phase = "commit", request_fingerprint = "load-budget-probe", state = states[i], entries = entries, created_tick = D4_Tick(), completed_tick = D4_Tick(), result = null, rollback = null };
	this.store.journal.operations[ids[i]] <- op;
	this.store.journal.order.append(ids[i]);
}
return { ok = true, payload = { seeded = ids.len(), entries_each = entries.len() } };
}
if (payload.command == "load_budget_probe_status") {
	local first = this.store.journal.Get("directorate-gate.partial-a");
	local second = this.store.journal.Get("directorate-gate.partial-b");
	return { ok = true, payload = { all_retained = first != null && second != null, first_entries = first == null ? -1 : first.entries.len(), second_entries = second == null ? -1 : second.entries.len(), active_count = this.store.journal.order.len(), deferred_count = this.store.journal.deferred_order.len() } };
}
if (payload.command == "capacity_probe_fill") {
	local source = this.store.journal.Get("directorate-gate.partial-a");
	if (source == null || source.entries.len() == 0) return { ok = false, error = D4_Error("capacity_probe_source_missing", "") };
	local entry = source.entries[0];
	local index = 0;
	while (this.store.journal.order.len() < DIRECTORATE_M4_MAX_OPERATIONS) {
		local id = "directorate-gate.capacity-" + index.tostring();
		index++;
		if (id in this.store.journal.operations) continue;
		this.store.journal.operations[id] <- { operation_id = id, company_id = 0, plan_id = "directorate-gate-plan", revision = 4, phase = "commit", request_fingerprint = "capacity-probe", state = "failed_partial", entries = [entry], created_tick = D4_Tick(), completed_tick = D4_Tick(), result = null, rollback = null };
		this.store.journal.order.append(id);
	}
	return { ok = true, payload = { active_count = this.store.journal.order.len() } };
}
`;
  const fixtureBridgeWithProbe = fixtureBridge.replace('\t\tif (payload.command == "survey_sites") {', migrationProbe + '\t\tif (payload.command == "survey_sites") {');
  if (fixtureBridgeWithProbe === fixtureBridge) throw new Error("failed to inject migration safety probe");
  writeFileSync(fixtureBridgePath, fixtureBridgeWithProbe);
  cpSync(openGfx, join(fixture, "baseset"), { recursive: true });
  writeFileSync(
    join(fixture, "ai/directorate_gate_fixture/info.nut"),
    `class DirectorateGateFixtureInfo extends AIInfo {
  function GetAuthor()      { return "OpenTTD Directorate"; }
  function GetName()        { return "Directorate Gate Fixture"; }
  function GetDescription() { return "Disposable no-op company for the directorate real-engine gate"; }
  function GetVersion()     { return 1; }
  function GetDate()        { return "2026-07-29"; }
  function CreateInstance() { return "DirectorateGateFixture"; }
  function GetShortName()   { return "D4GF"; }
  function GetAPIVersion()  { return "15"; }
}
RegisterAI(DirectorateGateFixtureInfo());
`,
  );
  writeFileSync(
    join(fixture, "ai/directorate_gate_fixture/main.nut"),
    `class DirectorateGateFixture extends AIController {
  function Start() {
    while (true) this.Sleep(100);
  }
}
`,
  );
  writeFileSync(
    join(fixture, "openttd.cfg"),
    `[misc]
autosave = off

[music]
name = NoMusic

[game_scripts]
"OpenTTD Directorate" = 4

[network]
server_admin_port = ${port}
admin_password = ${password}
allow_insecure_admin_login = true
server_game_type = local
server_name = "OpenTTD Directorate Real Engine Gate"
max_companies = 4

[game_creation]
map_x = 6
map_y = 6
starting_year = 1950

[difficulty]
industry_density = 4
number_towns = 3
terrain_type = 0
quantity_sea_lakes = 0

[gui]
autosave_interval = 0
`,
  );
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function assertOk(name, response) {
  if (!response?.ok) throw new Error(`${name} failed: ${JSON.stringify(response)}`);
  return response;
}

function assertNotOk(name, response) {
  if (response?.ok) throw new Error(`${name} unexpectedly succeeded: ${JSON.stringify(response)}`);
  return response;
}

function assertRouteCommissioned(name, response) {
  if (!response?.ok) throw new Error(`${name} failed: ${JSON.stringify(response)}`);
  const route = response.payload?.route ?? response.payload?.response?.route;
  if (typeof route?.route_id !== "string") throw new Error(`${name} missing route_id`);
  if (route?.state !== "commissioned") throw new Error(`${name} not commissioned: ${JSON.stringify(route)}`);
  if (typeof response.payload?.vehicle_id !== "number" && typeof response.payload?.response?.vehicle_id !== "number") {
    throw new Error(`${name} missing vehicle_id`);
  }
  return response;
}

async function withServer(loadGame, fn) {
  serverRun += 1;
  const runLogPath = `${logPath}.${serverRun}`;
  const out = [];
  const args = [
    "-D",
    `127.0.0.1:${gamePort}`,
    "-c",
    join(fixture, "openttd.cfg"),
    "-x",
    "-X",
    "-g",
    ...(loadGame ? [loadGame] : []),
    "-G",
    "42",
    "-I",
    "OpenGFX",
    "-S",
    "NoSound",
    "-M",
    "NoMusic",
    "-d",
    "script=4,net=2,misc=0",
  ];
  const server = spawn(openttd, args, { cwd: fixture, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => out.push(chunk));
  server.stderr.on("data", (chunk) => out.push(chunk));
  let exit = null;
  server.on("exit", (code, signal) => {
    exit = { code, signal };
  });
  try {
    await delay(1500);
    if (exit) throw new Error(`OpenTTD exited before gate: ${JSON.stringify(exit)} ${Buffer.concat(out).toString("utf8").slice(0, 1000)}`);
    return await fn();
  } finally {
    server.kill("SIGTERM");
    await delay(500);
    if (!server.killed) server.kill("SIGKILL");
    writeFileSync(runLogPath, Buffer.concat(out).toString("utf8"));
    writeFileSync(logPath, Buffer.concat(out).toString("utf8"));
  }
}

async function request(handlers, op, payload) {
  const result = await handlers[op](payload);
  if (!Array.isArray(result?.content) || result.content.length < 1 || result.content[0]?.type !== "text") {
    throw new Error(`invalid ${op} response`);
  }
  const response = JSON.parse(result.content[0].text);
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    throw new Error(`invalid ${op} response body`);
  }
  if ((op === "commission" || op === "verify") && response.payload?.response !== undefined) {
    return { ...response, typed_payload: response.payload, payload: response.payload.response };
  }
  return response;
}

async function main() {
  writeConfig();
  const evidence = {
    fixture,
    openttd,
    openttd_version: openttdVersion,
    openttd_sha256: createHash("sha256").update(readFileSync(openttd)).digest("hex"),
    opengfx: openGfx,
    source_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    source_dirty: execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim().length > 0,
    port,
    game_port: gamePort,
    steps: [],
  };
  let planRevision = 0;
  let commitRevision = 0;
  let failed = false;
  try {
    await withServer(null, async () => {
      const client = new AdminClient({
        host: "127.0.0.1",
        port,
        password,
        name: "directorate real-engine gate",
        version: "0.1.0",
        requestTimeoutMs: 120000,
        connectTimeoutMs: 10000,
        pingIntervalMs: 0,
        reconnect: { enabled: false, maxAttempts: 0, initialDelayMs: 100, maxDelayMs: 100 },
        maxResponseBytes: 1024 * 1024,
        maxResponseChunks: 256,
        maxPendingRequests: 16,
      });
      await client.connect();
      const handlers = createToolHandlers(new AdminOpenTtdGateway(client));
      evidence.steps.push({ name: "connect", ok: true });
      const startAi = await client.rcon('start_ai "Directorate Gate Fixture"');
      evidence.steps.push({ name: "start_fixture_company", response: startAi });
      await delay(1000);
      evidence.steps.push({ name: "observe", response: assertOk("observe", await request(handlers, "observe", { scope: "plans", limit: 4 })) });

      const industryWire = await client.requestGameScript("execute", {
        company_id: 0,
        command: "list_industries",
        params: { cargo_label: "COAL", role: "source", limit: 4 },
      });
      const industryList = assertOk("list_industries", industryWire.payload);
      if (!Array.isArray(industryList.payload?.industries)) throw new Error(`industry discovery did not return an array: ${JSON.stringify(industryList)}`);
      evidence.steps.push({ name: "list_industries", response: industryWire });

      const plan = await request(handlers, "plan", {
        company_id: 0,
        plan_id: "directorate-gate-plan",
        intent: { source_industry_id: 0, destination_industry_id: 1 },
        policy: {
          station_template: "single_shuttle_1xN",
          site_search_radius: 2,
          route_expansion_limit: 768,
          route_frontier_limit: 4096,
          wagon_count: 3,
        },
      });
      evidence.steps.push({ name: "plan", response: assertOk("plan", plan) });

      if (!plan.ok || plan.payload?.revision === undefined) {
        throw new Error("plan did not return revision");
      }
      const revision = plan.payload.revision;
      planRevision = revision;

      const migrationSafetyWire = await client.requestGameScript("execute", {
        company_id: 0,
        command: "migration_safety_probe",
        params: { plan_id: "directorate-gate-plan" },
      });
      const migrationSafety = assertOk("migration_safety_probe", migrationSafetyWire.payload);
      if (migrationSafety.payload?.all_rejected !== true) throw new Error(`malformed v1 migration input was accepted: ${JSON.stringify(migrationSafety)}`);
      evidence.steps.push({ name: "migration_safety_probe", response: migrationSafetyWire });

      evidence.steps.push({
        name: "preflight",
        response: assertOk("preflight", await request(handlers, "apply", {
          company_id: 0,
          plan_id: "directorate-gate-plan",
          revision,
          phase: "preflight",
          operation_id: "directorate-gate.preflight",
        })),
      });
      const commit = assertOk("commit", await request(handlers, "apply", {
        company_id: 0,
        plan_id: "directorate-gate-plan",
        revision,
        phase: "commit",
        operation_id: "directorate-gate.commit",
      }));
      evidence.steps.push({ name: "commit", response: commit });
      commitRevision = commit.payload?.revision ?? revision + 1;

      const signalProbeWire = await client.requestGameScript("execute", {
        company_id: 0,
        command: "signal_api_probe",
        params: { plan_id: "directorate-gate-plan" },
      });
      const signalProbe = assertOk("signal_api_probe", signalProbeWire.payload);
      if (typeof signalProbe.payload?.signal_type !== "number" || signalProbe.payload?.removed !== true) throw new Error(`one-way PBS signal probe failed: ${JSON.stringify(signalProbe)}`);
      evidence.steps.push({ name: "signal_api_probe", response: signalProbeWire });

      const observeApplied = assertOk("observe_after_commit", await request(handlers, "observe", { scope: "plans", route_id: "directorate-gate-plan" }));
      if (observeApplied.payload?.plans?.[0]?.state !== "applied") throw new Error(`plan not applied: ${JSON.stringify(observeApplied)}`);
      evidence.steps.push({ name: "observe_after_commit", response: observeApplied });

      const commission = assertRouteCommissioned(
        "commission_route",
        await request(handlers, "commission", {
          company_id: 0,
          plan_id: "directorate-gate-plan",
          route_id: "directorate-gate-route",
          cargo_label: "",
        }),
      );
      const commissionedVehicle = commission.payload?.response ?? commission.payload;
      if (commissionedVehicle?.wagon_count !== 1 || commissionedVehicle?.capacity < 1 || commissionedVehicle?.length > 16) {
        throw new Error(`platform-bounded commissioning failed: ${JSON.stringify(commission)}`);
      }
      evidence.steps.push({ name: "commission_route", response: commission });

      const observeRoutes = assertOk("observe_routes", await request(handlers, "observe", { scope: "routes", company_id: 0, limit: 16 }));
      const routes = observeRoutes.payload?.routes ?? [];
      if (routes.length !== 1 || routes[0]?.route_id !== "directorate-gate-route") throw new Error(`expected one route, got ${JSON.stringify(routes)}`);
      if (routes[0]?.state !== "commissioned") throw new Error(`route not commissioned: ${JSON.stringify(routes[0])}`);
      evidence.steps.push({ name: "observe_routes", response: observeRoutes });

      const verifyTopology = assertOk("verify_topology", await request(handlers, "verify", { company_id: 0, route_id: "directorate-gate-route", level: "topology" }));
      if (verifyTopology.payload?.health?.topology_ok !== true) throw new Error(`topology not ok: ${JSON.stringify(verifyTopology)}`);
      evidence.steps.push({ name: "verify_topology", response: verifyTopology });

      const verifyCommissioning = assertOk("verify_commissioning", await request(handlers, "verify", { company_id: 0, route_id: "directorate-gate-route", level: "commissioning" }));
      if (verifyCommissioning.ok !== true) throw new Error(`commissioning verify failed: ${JSON.stringify(verifyCommissioning)}`);
      evidence.steps.push({ name: "verify_commissioning", response: verifyCommissioning });

      const verifyOperationCommit = await request(handlers, "verify", {
        company_id: 0,
        operation_id: "directorate-gate.commit",
        level: "topology",
      });
      evidence.steps.push({ name: "verify_commit_operation", response: verifyOperationCommit });
      if (!verifyOperationCommit.ok || verifyOperationCommit.payload?.result?.state !== "completed") {
        throw new Error(`commit operation did not verify to completed: ${JSON.stringify(verifyOperationCommit)}`);
      }

      const verifyEconomic = assertNotOk("verify_economic_before_travel", await request(handlers, "verify", { company_id: 0, route_id: "directorate-gate-route", level: "economic" }));
      if (verifyEconomic.payload?.health?.positive_revenue !== false) throw new Error(`economic verify unexpectedly profitable before travel: ${JSON.stringify(verifyEconomic)}`);
      evidence.steps.push({ name: "verify_economic_before_travel", response: verifyEconomic });

      evidence.steps.push({ name: "fastforward_on", response: await client.rcon("fastforward") });
      let profitable = false;
      for (let attempt = 0; attempt < 24; attempt++) {
        await delay(5000);
        const poll = await request(handlers, "verify", { company_id: 0, route_id: "directorate-gate-route", level: "economic" });
        if (typeof poll.payload?.health?.positive_revenue !== "boolean") throw new Error(`verify_economic_poll missing health: ${JSON.stringify(poll)}`);
        if (poll.ok === true && poll.payload.health.positive_revenue === true) {
          evidence.steps.push({ name: "verify_economic_profitable", attempt, response: poll });
          profitable = true;
          break;
        }
      }
      evidence.steps.push({ name: "fastforward_off", response: await client.rcon("fastforward") });
      if (!profitable) throw new Error(`route did not become profitable within poll window`);

      const verifyEconomicAfter = assertOk("verify_economic_after_travel", await request(handlers, "verify", { company_id: 0, route_id: "directorate-gate-route", level: "economic" }));
      if (verifyEconomicAfter.payload?.health?.vehicle_running !== true) throw new Error(`vehicle not running after travel: ${JSON.stringify(verifyEconomicAfter)}`);
      evidence.steps.push({ name: "verify_economic_after_travel", response: verifyEconomicAfter });

	  const loadBudgetWire = await client.requestGameScript("execute", { company_id: 0, command: "load_budget_probe_seed", params: {} });
	  const loadBudget = assertOk("load_budget_probe_seed", loadBudgetWire.payload);
	  if (loadBudget.payload?.seeded !== 2 || loadBudget.payload?.entries_each !== 111) throw new Error("load budget probe did not seed two 111-entry partial operations");
	  evidence.steps.push({ name: "load_budget_probe_seed", response: loadBudgetWire });
	  const capacityWire = await client.requestGameScript("execute", { company_id: 0, command: "capacity_probe_fill", params: {} });
	  const capacity = assertOk("capacity_probe_fill", capacityWire.payload);
	  if (capacity.payload?.active_count !== 256) throw new Error(`capacity probe did not fill journal: ${JSON.stringify(capacity)}`);
	  evidence.steps.push({ name: "capacity_probe_fill", response: capacityWire });

      evidence.steps.push({ name: "save", response: await client.rcon("save directorate_gate") });
      await client.shutdown();
    });

    const savePath = join(fixture, "save/directorate_gate.sav");
    if (!existsSync(savePath)) throw new Error(`save missing: ${savePath}`);

    await withServer(savePath, async () => {
      const client = new AdminClient({
        host: "127.0.0.1",
        port,
        password,
        name: "directorate real-engine gate restart",
        version: "0.1.0",
        requestTimeoutMs: 120000,
        connectTimeoutMs: 10000,
        pingIntervalMs: 0,
        reconnect: { enabled: false, maxAttempts: 0, initialDelayMs: 100, maxDelayMs: 100 },
        maxResponseBytes: 1024 * 1024,
        maxResponseChunks: 256,
        maxPendingRequests: 16,
      });
      await client.connect();
      const replayHandlers = createToolHandlers(new AdminOpenTtdGateway(client));
      evidence.steps.push({ name: "restart_connect", ok: true });

	  await delay(1000);
	  const retainedWire = await client.requestGameScript("execute", { company_id: 0, command: "load_budget_probe_status", params: {} });
	  const retained = assertOk("load_budget_probe_status", retainedWire.payload);
	  if (retained.payload?.all_retained !== true || retained.payload?.first_entries !== 111 || retained.payload?.second_entries !== 111 || retained.payload?.active_count !== 256 || retained.payload?.deferred_count !== 0) {
		throw new Error(`deferred partial journals were not all retained: ${JSON.stringify(retained)}`);
	  }
	  evidence.steps.push({ name: "load_budget_probe_status", response: retainedWire });

	  const immediateReplay = assertNotOk("immediate_deferred_replay", await request(replayHandlers, "apply", {
		company_id: 0,
		plan_id: "directorate-gate-plan",
		revision: 4,
		phase: "commit",
		operation_id: "directorate-gate.partial-b",
		reserve: 0,
	  }));
	  evidence.steps.push({ name: "immediate_deferred_replay", response: immediateReplay });
	  const afterReplayWire = await client.requestGameScript("execute", { company_id: 0, command: "load_budget_probe_status", params: {} });
	  const afterReplay = assertOk("load_budget_probe_status_after_replay", afterReplayWire.payload);
	  if (afterReplay.payload?.active_count !== 256 || afterReplay.payload?.deferred_count !== 0 || afterReplay.payload?.second_entries !== 111) throw new Error(`immediate replay changed persisted journal: ${JSON.stringify(afterReplay)}`);
	  evidence.steps.push({ name: "load_budget_probe_status_after_replay", response: afterReplayWire });

      const replayCommission = await request(replayHandlers, "commission", {
        company_id: 0,
        plan_id: "directorate-gate-plan",
        route_id: "directorate-gate-route",
        cargo_label: "",
      });
      if (replayCommission.payload?.note !== "idempotent") {
        throw new Error(`commission replay not idempotent: ${JSON.stringify(replayCommission)}`);
      }
      evidence.steps.push({ name: "commission_replay_after_restart", response: replayCommission });

      const observeAfterRestart = assertOk("observe_routes_after_restart", await request(replayHandlers, "observe", { scope: "routes", company_id: 0, limit: 16 }));
      const afterRoutes = observeAfterRestart.payload?.routes ?? [];
      if (afterRoutes.length !== 1) throw new Error(`expected one persisted route after restart, got ${JSON.stringify(afterRoutes)}`);
      evidence.steps.push({ name: "observe_routes_after_restart", response: observeAfterRestart });

      const verifyAfterRestart = assertOk("verify_topology_after_restart", await request(replayHandlers, "verify", { company_id: 0, route_id: "directorate-gate-route", level: "topology" }));
      if (verifyAfterRestart.payload?.health?.topology_ok !== true) throw new Error(`topology not ok after restart: ${JSON.stringify(verifyAfterRestart)}`);
      evidence.steps.push({ name: "verify_topology_after_restart", response: verifyAfterRestart });

	  const rollbackProbe = assertOk("load_budget_probe_rollback", await request(replayHandlers, "apply", {
		company_id: 0,
		plan_id: "directorate-gate-plan",
		revision: 4,
		phase: "rollback",
		operation_id: "directorate-gate.partial-rollback",
		target_operation_id: "directorate-gate.partial-a",
		reserve: 0,
	  }));
	  if (rollbackProbe.payload?.remaining?.length !== 0) throw new Error(`deferred rollback did not complete: ${JSON.stringify(rollbackProbe)}`);
	  evidence.steps.push({ name: "load_budget_probe_rollback", response: rollbackProbe });
      await client.shutdown();
    });
  } catch (error) {
    failed = true;
    evidence.steps.push({ name: "blocked_or_failed", message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  } finally {
    evidence.log = logPath;
    try {
      evidence.log_excerpt = existsSync(logPath) ? readFileSync(logPath, "utf8").slice(0, 2000) : "";
    } catch {
      evidence.log_excerpt = "";
    }
    evidence.evidence_path = failed ? join(fixture, "directorate-real-engine-gate-failed.json") : evidencePath;
    writeFileSync(evidence.evidence_path, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
    if (process.env.OPENTTD_GATE_KEEP_FIXTURE !== "1" && !failed) rmSync(fixture, { recursive: true, force: true });
  }
}

await main();
