import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const gameRoot = "game";

function directoriesUnder(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

test("there is exactly one tracked GameScript package and legacy milestone directories removed", () => {
  const entries = directoriesUnder(gameRoot).filter((name) => name.startsWith("openttd_directorate"));
  assert.deepEqual(entries, ["openttd_directorate"]);
  assert.deepEqual(directoriesUnder(gameRoot), ["openttd_directorate"]);
});

test("stable GameScript identity uses public release names and version/date", () => {
  const source = readFileSync("game/openttd_directorate/info.nut", "utf8");
  assert.match(source, /GetName\(\)\s*\{\s*return\s*\"OpenTTD Directorate\"/);
  assert.match(source, /GetShortName\(\)\s*\{\s*return\s*\"DRCT\"/);
  assert.match(source, /GetVersion\(\)\s*\{\s*return\s*4/);
  assert.match(source, /GetDate\(\)\s*\{\s*return\s*\"2026-07-30\"/);
  assert.match(source, /class OpenTTDDirectorateInfo/);
  assert.match(source, /CreateInstance\(\)\s*\{\s*return\s*\"OpenTTDDirectorate\"/);
});

test("stable typed end-to-end gate targets game/openttd_directorate", () => {
  const source = readFileSync("tests/integration/directorate-real-engine-gate.mjs", "utf8");
  assert.match(source, /game\/openttd_directorate/);
  assert.match(source, /"OpenTTD Directorate" = 4/);
  assert.match(source, /process\.env\.OPENTTD_OPENGFX_DIR/);
  assert.match(source, /spawnSync\(openttd, \["-v"\]/);
  assert.match(source, /OpenTTD 15\.3 required/);
  assert.doesNotMatch(source, /_m2|_m3/);
});
