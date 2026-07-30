import assert from "node:assert/strict";
import test from "node:test";
import {
  DIR_NE,
  DIR_NW,
  DIR_SE,
  DIR_SW,
  adjacent,
  deriveCorridor,
  directionBetween,
  directionName,
  forwardRight,
  isNinetyTurn,
  legalPrimitive,
  normalizeEndpoints,
  offset,
  rotateDirection,
} from "../src/gamescript/geometry.js";

test("pure geometry direction rotations and offsets are deterministic", () => {
  assert.equal(directionName(DIR_NE), "NE");
  assert.equal(rotateDirection(DIR_NE, 1), DIR_SE);
  assert.equal(rotateDirection(DIR_NE, 2), DIR_SW);
  assert.equal(rotateDirection(DIR_NE, 3), DIR_NW);
  assert.deepEqual(offset({ x: 4, y: 5 }, DIR_SW, 3), { x: 1, y: 5 });
  assert.deepEqual(forwardRight({ x: 10, y: 20 }, DIR_NE, 3, 2), { x: 13, y: 22 });
  assert.equal(directionBetween({ x: 1, y: 1 }, { x: 1, y: 2 }), DIR_SE);
});

test("endpoint normalization and legality primitives reject unsafe turns", () => {
  assert.deepEqual(normalizeEndpoints({ x: 9, y: 1 }, { x: 2, y: 8 }), {
    start: { x: 2, y: 8 },
    goal: { x: 9, y: 1 },
    swapped: true,
  });
  assert.equal(legalPrimitive({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }), true);
  assert.equal(legalPrimitive({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }), true);
  assert.equal(isNinetyTurn({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }), true);
  assert.equal(legalPrimitive({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }), false);
});

test("paired corridor miters a legal turn without overlaps or gaps", () => {
  const corridor = deriveCorridor([
    { x: 120, y: 120 },
    { x: 121, y: 120 },
    { x: 122, y: 120 },
    { x: 123, y: 120 },
    { x: 124, y: 120 },
    { x: 124, y: 121 },
    { x: 124, y: 122 },
    { x: 124, y: 123 },
  ]);
  assert.equal(corridor.ok, true);
  assert.ok("lanes" in corridor);
  if (!("lanes" in corridor)) return;
  for (const lane of corridor.lanes) {
    for (let index = 1; index < lane.length; index += 1) assert.equal(adjacent(lane[index - 1]!, lane[index]!), true);
  }
});

test("paired one-way corridor derives lanes, throat ports, and conflicts", () => {
  const corridor = deriveCorridor(
    [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 12, y: 10 },
    ],
    1,
    "right",
  );
  assert.equal(corridor.ok, true);
  assert.deepEqual("lanes" in corridor ? corridor.lanes[0] : [], [
    { x: 10, y: 11 },
    { x: 11, y: 11 },
    { x: 12, y: 11 },
  ]);
  assert.deepEqual("ports" in corridor ? corridor.ports.merge_in : [], [
    { x: 10, y: 11 },
    { x: 10, y: 9 },
  ]);
});

test("paired corridor expands outer corners and contracts inner corners without loops", () => {
  const corridor = deriveCorridor(
    [
      { x: 120, y: 120 },
      { x: 121, y: 120 },
      { x: 122, y: 120 },
      { x: 123, y: 120 },
      { x: 124, y: 120 },
      { x: 124, y: 121 },
      { x: 124, y: 122 },
      { x: 124, y: 123 },
    ],
    1,
    "right",
  );
  assert.equal(corridor.ok, true);
  if (!("lanes" in corridor)) return;
  for (const lane of corridor.lanes) {
    assert.equal(new Set(lane.map((point) => `${point.x},${point.y}`)).size, lane.length);
    for (let index = 1; index < lane.length; index += 1) {
      assert.equal(Math.abs(lane[index]!.x - lane[index - 1]!.x) + Math.abs(lane[index]!.y - lane[index - 1]!.y), 1);
    }
  }
});
