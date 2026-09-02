import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFlow,
  buildGraph,
  typecheckGraph,
  compileFlow,
  type FlowBindings,
} from "../../src/orchestration/flow-dsl/index.js";
import {
  CONSULTA_SCHEDULING_DSL,
  CONSULTA_SCHEDULING_BINDINGS,
} from "../../src/orchestration/flows/consulta-scheduling.flow.js";
import { SEMANTIC_TYPE } from "../../config/semantic-types.js";

test("the consulta-scheduling flow satisfies its type contract", () => {
  const graph = buildGraph(parseFlow(CONSULTA_SCHEDULING_DSL), CONSULTA_SCHEDULING_BINDINGS);
  const result = typecheckGraph(graph);
  assert.equal(result.ok, true, result.report);
  assert.equal(graph.entryType, SEMANTIC_TYPE.intakeSubmission);
  assert.equal(graph.exitType, SEMANTIC_TYPE.confirmedConsulta);
});

test("compileFlow throws a pedagogical error when a transform step is skipped", () => {
  // ScoreAffinity emits ScoredCandidateSet; wiring it straight into a node that
  // wants MatchedIntake must be rejected (2Flow "Regra de Tipos em Comptime").
  const bindings: FlowBindings = {
    A: {
      role: "action",
      inputType: SEMANTIC_TYPE.triagedIntake,
      outputType: SEMANTIC_TYPE.scoredCandidateSet,
    },
    B: {
      role: "action",
      inputType: SEMANTIC_TYPE.matchedIntake,
      outputType: SEMANTIC_TYPE.queuedIntake,
    },
  };
  assert.throws(
    () => compileFlow("A :--: B", bindings),
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      assert.match(msg, /FALHA DE CONTRATO DE TIPAGEM/);
      assert.match(msg, /ScoredCandidateSet/);
      assert.match(msg, /MatchedIntake/);
      return true;
    },
  );
});

test("saga edge requires the compensator to share the action's input context", () => {
  const bindings: FlowBindings = {
    Reserve: {
      role: "action",
      inputType: SEMANTIC_TYPE.queuedIntake,
      outputType: SEMANTIC_TYPE.scheduledConsulta,
    },
    BadComp: {
      role: "compensator",
      inputType: SEMANTIC_TYPE.confirmedConsulta,
      outputType: SEMANTIC_TYPE.queuedIntake,
    },
  };
  const graph = buildGraph(parseFlow("Reserve !-> BadComp"), bindings);
  const result = typecheckGraph(graph);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((x) => x.hint.startsWith("saga")));
});

test("unbound node names are rejected before type checking", () => {
  assert.throws(() => buildGraph(parseFlow("A :--: B"), { A: {
    role: "action",
    inputType: SEMANTIC_TYPE.triagedIntake,
    outputType: SEMANTIC_TYPE.triagedIntake,
  } }));
});
