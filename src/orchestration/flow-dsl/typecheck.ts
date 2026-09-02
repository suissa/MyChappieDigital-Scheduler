/**
 * Flow-graph static type checker — the 2Flow "Regra de Tipos em Comptime":
 *
 *     OutputType(Node A) ≡ InputType(Node B)   for every edge A :--: B
 *
 * Rules:
 *   sequence  A → B            OutputType(A) ≡ InputType(B)
 *   fork      up → branch[i]₀  OutputType(up) ≡ InputType(branch[i]₀)   (every branch)
 *   join      branch[0]ₙ → dn  OutputType(primary branch) ≡ InputType(dn)
 *   saga      A !-> Comp       InputType(A) ≡ InputType(Comp)   (compensation restores
 *                              consistency from the same starting context)
 *
 * On a violation it produces a pedagogical diagnostic in the Lucy-mae box style.
 */

import { semanticTypesEqual } from "../../../config/semantic-types.js";
import type { FlowGraph, GraphNode, Stage } from "./graph.js";

export interface TypeViolation {
  readonly edge: string;
  readonly fromNode: string;
  readonly fromType: string;
  readonly toNode: string;
  readonly toType: string;
  readonly hint: string;
}

export interface TypeCheckResult {
  readonly ok: boolean;
  readonly violations: readonly TypeViolation[];
  readonly report: string;
}

const violation = (
  kind: string,
  from: GraphNode,
  to: GraphNode,
  hint: string,
): TypeViolation => ({
  edge: `${from.name} :--: ${to.name}`,
  fromNode: from.name,
  fromType: from.outputType,
  toNode: to.name,
  toType: to.inputType,
  hint: `${kind}: ${hint}`,
});

const checkChain = (chain: readonly GraphNode[], out: TypeViolation[]): void => {
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i]!;
    const b = chain[i + 1]!;
    if (!semanticTypesEqual(a.outputType, b.inputType)) {
      out.push(
        violation(
          "sequence",
          a,
          b,
          `insira as etapas que transformam ${a.outputType} em ${b.inputType} antes de '${b.name}'.`,
        ),
      );
    }
  }
};

const firstNode = (s: Stage): GraphNode => (s.kind === "fork-join" ? s.branches[0]![0]! : s.node);
const primaryLast = (s: Stage): GraphNode =>
  s.kind === "fork-join"
    ? s.branches[0]![s.branches[0]!.length - 1]!
    : s.node;

export const typecheckGraph = (graph: FlowGraph): TypeCheckResult => {
  const v: TypeViolation[] = [];

  for (let i = 0; i < graph.stages.length; i++) {
    const stage = graph.stages[i]!;

    if (stage.kind === "action" && stage.compensator) {
      if (!semanticTypesEqual(stage.node.inputType, stage.compensator.inputType)) {
        v.push(
          violation(
            "saga",
            stage.node,
            stage.compensator,
            `o compensador '${stage.compensator.name}' deve partir do mesmo contexto ` +
              `de entrada de '${stage.node.name}' (${stage.node.inputType}).`,
          ),
        );
      }
    }

    if (stage.kind === "fork-join") {
      for (const branch of stage.branches) checkChain(branch, v);
    }

    if (i + 1 < graph.stages.length) {
      const next = graph.stages[i + 1]!;
      const upstreamOut = primaryLast(stage).outputType;

      if (next.kind === "fork-join") {
        for (const branch of next.branches) {
          const bFirst = branch[0]!;
          if (!semanticTypesEqual(upstreamOut, bFirst.inputType)) {
            v.push(violation("fork", primaryLast(stage), bFirst, `o ramo '${bFirst.name}' precisa aceitar ${upstreamOut}.`));
          }
        }
      } else {
        const dn = firstNode(next);
        if (!semanticTypesEqual(upstreamOut, dn.inputType)) {
          v.push(
            violation(
              stage.kind === "fork-join" ? "join" : "sequence",
              primaryLast(stage),
              dn,
              `insira as etapas que transformam ${upstreamOut} em ${dn.inputType} antes de '${dn.name}'.`,
            ),
          );
        }
      }
    }
  }

  return { ok: v.length === 0, violations: v, report: renderReport(graph, v) };
};

const renderReport = (graph: FlowGraph, violations: readonly TypeViolation[]): string => {
  if (violations.length === 0) {
    return (
      `┌── ✅ CONTRATO DE TIPAGEM DO PIPELINE: OK ` +
      `${"─".repeat(28)}┐\n` +
      `│  ${graph.nodes.length} nós · ${graph.edges.length} arestas\n` +
      `│  entrada: ${graph.entryType}  →  saída: ${graph.exitType}\n` +
      `└${"─".repeat(64)}┘`
    );
  }
  const lines: string[] = [];
  lines.push(`┌── 🛑 FALHA DE CONTRATO DE TIPAGEM NO PIPELINE ${"─".repeat(24)}┐`);
  for (const x of violations) {
    lines.push(`│`);
    lines.push(`│  Fluxo inválido : ${x.edge}`);
    lines.push(`│    1. '${x.fromNode}' emite o tipo:  👉 [ ${x.fromType} ]`);
    lines.push(`│    2. '${x.toNode}' espera consumir:  📥 [ ${x.toType} ]`);
    lines.push(`│  💡 ${x.hint}`);
  }
  lines.push(`└${"─".repeat(70)}┘`);
  return lines.join("\n");
};
