import assert from "node:assert/strict";
import test from "node:test";
import { parseEnv } from "../src/config/env.js";

test("ping interval is disabled with zero or bounded to a practical minimum", () => {
  assert.equal(parseEnv({ OPENTTD_PING_INTERVAL_MS: "0" }).admin.pingIntervalMs, 0);
  assert.equal(parseEnv({ OPENTTD_PING_INTERVAL_MS: "1000" }).admin.pingIntervalMs, 1000);
  assert.throws(() => parseEnv({ OPENTTD_PING_INTERVAL_MS: "1" }), /Expected integer string between 1000 and 300000/);
});
