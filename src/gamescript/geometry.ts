export type Direction = 0 | 1 | 2 | 3;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const DIR_NE = 0;
export const DIR_SE = 1;
export const DIR_SW = 2;
export const DIR_NW = 3;

const names = ["NE", "SE", "SW", "NW"] as const;

export function directionName(direction: Direction): string {
  return names[direction];
}

export function rotateDirection(direction: Direction, turns: number): Direction {
  return (((direction + turns) % 4) + 4) % 4 as Direction;
}

export function rightDirection(direction: Direction): Direction {
  return rotateDirection(direction, 1);
}

export function leftDirection(direction: Direction): Direction {
  return rotateDirection(direction, 3);
}

export function offset(point: Point, direction: Direction, count = 1): Point {
  switch (direction) {
    case DIR_NE:
      return { x: point.x + count, y: point.y };
    case DIR_SE:
      return { x: point.x, y: point.y + count };
    case DIR_SW:
      return { x: point.x - count, y: point.y };
    case DIR_NW:
      return { x: point.x, y: point.y - count };
  }
}

export function forwardRight(point: Point, direction: Direction, forward: number, right: number): Point {
  return offset(offset(point, direction, forward), rightDirection(direction), right);
}

export function adjacent(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

export function directionBetween(a: Point, b: Point): Direction | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 1 && dy === 0) return DIR_NE;
  if (dx === 0 && dy === 1) return DIR_SE;
  if (dx === -1 && dy === 0) return DIR_SW;
  if (dx === 0 && dy === -1) return DIR_NW;
  return undefined;
}

export function normalizeEndpoints(a: Point, b: Point): { start: Point; goal: Point; swapped: boolean } {
  if (a.x < b.x || (a.x === b.x && a.y <= b.y)) return { start: a, goal: b, swapped: false };
  return { start: b, goal: a, swapped: true };
}

export function legalPrimitive(prev: Point, tile: Point, next: Point): boolean {
  if (!adjacent(prev, tile) || !adjacent(tile, next)) return false;
  const d1 = directionBetween(prev, tile);
  const d2 = directionBetween(tile, next);
  if (d1 === undefined || d2 === undefined) return false;
  return d1 === d2 || d2 !== rotateDirection(d1, 2);
}

export function isNinetyTurn(prev: Point, tile: Point, next: Point): boolean {
  const d1 = directionBetween(prev, tile);
  const d2 = directionBetween(tile, next);
  return d1 === undefined || d2 === undefined || d2 === rightDirection(d1) || d2 === leftDirection(d1);
}

export function deriveCorridor(centerline: readonly Point[], spacing = 1, handedness: "left" | "right" = "right") {
  if (centerline.length < 2 || centerline.length > 1024) return { ok: false, error: "invalid_centerline" as const };
  const side = handedness === "left" ? -spacing : spacing;
  const laneA: Point[] = [];
  const laneB: Point[] = [];
  const seen = new Set<string>();
  const conflicts: string[] = [];
  const append = (lane: Point[], point: Point) => {
    if (lane.at(-1)?.x === point.x && lane.at(-1)?.y === point.y) return;
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) conflicts.push(key);
    seen.add(key);
    lane.push(point);
  };
  const appendAt = (index: number, laneSide: number, lane: Point[]) => {
    const incoming = index > 0 ? directionBetween(centerline[index - 1]!, centerline[index]!) : undefined;
    const outgoing = index + 1 < centerline.length ? directionBetween(centerline[index]!, centerline[index + 1]!) : undefined;
    if (incoming === undefined && outgoing === undefined) return false;
    if (incoming === undefined) {
      append(lane, offset(centerline[index]!, rightDirection(outgoing!), laneSide));
      return true;
    }
    if (outgoing === undefined || incoming === outgoing) {
      append(lane, offset(centerline[index]!, rightDirection(incoming), laneSide));
      return true;
    }
    if (outgoing === rotateDirection(incoming, 2)) return false;
    const turnRight = outgoing === rightDirection(incoming);
    const inside = (turnRight && laneSide > 0) || (!turnRight && laneSide < 0);
    const incomingPoint = offset(centerline[index]!, rightDirection(incoming), laneSide);
    const outgoingPoint = offset(centerline[index]!, rightDirection(outgoing), laneSide);
    const corner = offset(incomingPoint, rightDirection(outgoing), laneSide);
    if (inside) {
      append(lane, corner);
    } else {
      append(lane, incomingPoint);
      append(lane, corner);
      append(lane, outgoingPoint);
    }
    return true;
  };
  for (let i = 0; i < centerline.length; i += 1) {
    if (!appendAt(i, side, laneA) || !appendAt(i, -side, laneB)) return { ok: false, error: "non_adjacent_centerline" as const };
  }
  return {
    ok: conflicts.length === 0,
    lanes: [laneA, laneB] as const,
    ports: { merge_in: [laneA[0], laneB[0]], split_out: [laneA.at(-1), laneB.at(-1)], handedness, spacing },
    conflicts,
  };
}
