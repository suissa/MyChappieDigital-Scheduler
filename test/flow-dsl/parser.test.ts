import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../../src/orchestration/flow-dsl/tokens.js";
import { parseFlow, flowNodeNames } from "../../src/orchestration/flow-dsl/parser.js";
import { CONSULTA_SCHEDULING_DSL } from "../../src/orchestration/flows/consulta-scheduling.flow.js";

test("tokenizes every operator", () => {
  const t = tokenize("A :--: [B, C :--: D] :--: [?G] :--: E !-> F");
  const kinds = t.map((x) => x.type);
  assert.ok(kinds.includes("sequence"));
  assert.ok(kinds.includes("fork-open"));
  assert.ok(kinds.includes("branch-sep"));
  assert.ok(kinds.includes("gate-mark"));
  assert.ok(kinds.includes("saga"));
});

test("parses a linear sequence", () => {
  const ast = parseFlow("A :--: B :--: C");
  assert.equal(ast.segments.length, 3);
  assert.deepEqual(
    ast.segments.map((s) => (s.kind === "step" ? s.action : s.kind)),
    ["A", "B", "C"],
  );
});

test("`!->` binds tighter than `:--:`", () => {
  const ast = parseFlow("A !-> Comp :--: C");
  assert.equal(ast.segments.length, 2);
  const first = ast.segments[0]!;
  assert.equal(first.kind, "step");
  assert.equal(first.kind === "step" && first.compensator, "Comp");
});

test("parses fork-join with an inner mini-sequence", () => {
  const ast = parseFlow("A :--: [B :--: C, D] :--: E");
  const fork = ast.segments[1]!;
  assert.equal(fork.kind, "fork-join");
  if (fork.kind !== "fork-join") throw new Error();
  assert.equal(fork.branches.length, 2);
  assert.equal(fork.branches[0]!.length, 2);
  assert.equal(fork.branches[1]!.length, 1);
});

test("parses a HITL gate", () => {
  const ast = parseFlow("A :--: [?Approval] :--: B");
  assert.equal(ast.segments[1]!.kind, "gate");
});

test("rejects malformed input", () => {
  assert.throws(() => parseFlow("A :--: :--: B"));
  assert.throws(() => parseFlow("A :--: [B, "));
  assert.throws(() => parseFlow("@bad"));
});

test("the consulta-scheduling flow lists every node", () => {
  const names = flowNodeNames(parseFlow(CONSULTA_SCHEDULING_DSL)).sort();
  assert.deepEqual(names, [
    "AssignQueueSlot",
    "ClinicalReview",
    "NotifyPatient",
    "RankProfessional",
    "ReceiveIntake",
    "RecordConsulta",
    "ReleaseSlotHold",
    "ReserveConsultaSlot",
    "ScoreAffinity",
    "ScreenClinicPolicy",
    "TriageComplaint",
  ]);
});
