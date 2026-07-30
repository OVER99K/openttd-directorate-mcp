import assert from "node:assert/strict";
import test from "node:test";

type Phase = "preflight" | "commit" | "rollback";
type State = "created" | "preflighted" | "in_progress" | "completed" | "failed_partial" | "rolled_back";
type EntryKind = "created" | "reused";

interface JournalEntry {
  kind: EntryKind;
  tile: number;
  detail: { kind: "rail" | "station" | "depot" | "signal"; front?: number; track?: number };
}

interface Operation {
  operationId: string;
  companyId: number;
  planId: string;
  revision: number;
  phase: Phase;
  state: State;
  entries: JournalEntry[];
  result?: Record<string, unknown>;
}

class ReferenceJournal {
  readonly operations = new Map<string, Operation>();
  readonly order: string[] = [];

  constructor(private readonly maxOperations = 4) {}

  create(operationId: string, companyId: number, planId: string, revision: number, phase: Phase): Operation {
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(operationId)) throw new Error("invalid_operation_id");
    if (this.operations.size >= this.maxOperations) throw new Error("operation_capacity");
    const op: Operation = { operationId, companyId, planId, revision, phase, state: "created", entries: [] };
    this.operations.set(operationId, op);
    this.order.push(operationId);
    return op;
  }

  reuse(operationId: string, companyId: number, planId: string, revision: number, phase: Phase) {
    const op = this.operations.get(operationId);
    if (!op) return undefined;
    assert.equal(op.companyId, companyId, "company fence");
    assert.equal(op.planId, planId, "plan fence");
    assert.equal(op.revision, revision, "revision fence");
    assert.equal(op.phase, phase, "phase fence");
    if (op.state === "preflighted" || op.state === "completed" || op.state === "rolled_back") {
      return { ok: true, ...op.result, operation_id: operationId, state: op.state, note: "idempotent" };
    }
    return { ok: false, operation_id: operationId, state: op.state };
  }

  rollback(target: Operation, removedTiles: Set<number>) {
    const remaining: JournalEntry[] = [];
    for (const entry of [...target.entries].reverse()) {
      if (entry.kind !== "created") continue;
      if (removedTiles.has(entry.tile)) continue;
      remaining.push(entry);
    }
    target.state = "rolled_back";
    target.result = { remaining: remaining.map((entry) => entry.tile) };
    return remaining;
  }
}

test("operation ids are stable keys from creation and replay is deterministic", () => {
  const journal = new ReferenceJournal();
  const op = journal.create("m3.preflight:1", 1, "plan-1", 3, "preflight");
  op.state = "preflighted";
  op.result = { cost: 123, mutation: false };

  assert.equal(journal.operations.get("m3.preflight:1"), op);
  assert.deepEqual(journal.reuse("m3.preflight:1", 1, "plan-1", 3, "preflight"), {
    ok: true,
    cost: 123,
    mutation: false,
    operation_id: "m3.preflight:1",
    state: "preflighted",
    note: "idempotent",
  });
});

test("operation id reuse requires exact company, plan, revision, and phase", () => {
  const journal = new ReferenceJournal();
  journal.create("m3.commit:1", 1, "plan-1", 3, "commit");

  assert.throws(() => journal.reuse("m3.commit:1", 2, "plan-1", 3, "commit"), /company fence/);
  assert.throws(() => journal.reuse("m3.commit:1", 1, "plan-2", 3, "commit"), /plan fence/);
  assert.throws(() => journal.reuse("m3.commit:1", 1, "plan-1", 4, "commit"), /revision fence/);
  assert.throws(() => journal.reuse("m3.commit:1", 1, "plan-1", 3, "rollback"), /phase fence/);
});

test("nonterminal and failed operations do not repeat mutation silently", () => {
  const journal = new ReferenceJournal();
  journal.create("m3.commit:created", 1, "plan-1", 3, "commit");
  const inProgress = journal.create("m3.commit:in_progress", 1, "plan-1", 3, "commit");
  inProgress.state = "in_progress";
  const failed = journal.create("m3.commit:failed", 1, "plan-1", 3, "commit");
  failed.state = "failed_partial";

  assert.deepEqual(journal.reuse("m3.commit:created", 1, "plan-1", 3, "commit"), {
    ok: false,
    operation_id: "m3.commit:created",
    state: "created",
  });
  assert.deepEqual(journal.reuse("m3.commit:in_progress", 1, "plan-1", 3, "commit"), {
    ok: false,
    operation_id: "m3.commit:in_progress",
    state: "in_progress",
  });
  assert.deepEqual(journal.reuse("m3.commit:failed", 1, "plan-1", 3, "commit"), {
    ok: false,
    operation_id: "m3.commit:failed",
    state: "failed_partial",
  });
});

test("rollback removes only created entries and keeps reused infrastructure", () => {
  const journal = new ReferenceJournal();
  const op = journal.create("m3.commit:rollback", 1, "plan-1", 3, "commit");
  op.entries.push(
    { kind: "created", tile: 10, detail: { kind: "rail", track: 1 } },
    { kind: "reused", tile: 20, detail: { kind: "rail", track: 1 } },
    { kind: "created", tile: 30, detail: { kind: "depot", front: 31 } },
  );

  const remaining = journal.rollback(op, new Set([10, 30]));
  assert.deepEqual(remaining, []);
  assert.equal(op.state, "rolled_back");
  assert.equal(op.entries.some((entry) => entry.kind === "reused" && entry.tile === 20), true);
});

test("operation count and id format are bounded", () => {
  const journal = new ReferenceJournal(1);
  journal.create("m3.ok-1", 1, "plan-1", 0, "preflight");
  assert.throws(() => journal.create("bad id with spaces", 1, "plan-1", 0, "preflight"), /invalid_operation_id/);
  assert.throws(() => journal.create("m3.ok-2", 1, "plan-1", 0, "preflight"), /operation_capacity/);
});
