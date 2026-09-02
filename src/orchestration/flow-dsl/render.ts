/**
 * Flow-graph renderer — an ASCII topology in the Lucy-mae 2Flow style, plus a
 * compact edge table and a Mermaid rendering.
 */

import type { FlowGraph, Stage } from "./graph.js";

const box = (label: string): string => `[ ${label} ]`;

export const renderTopology = (graph: FlowGraph): string => {
  const out: string[] = [];
  out.push(`FLOW  ${graph.entryType}  ⟶  ${graph.exitType}`);
  out.push(`DSL   ${graph.source}`);
  out.push("");

  graph.stages.forEach((stage: Stage, i) => {
    const arrow = i === 0 ? "" : "   │\n   ▼\n";
    if (stage.kind === "action") {
      out.push(arrow + box(`${stage.node.name}  : ${stage.node.inputType} ⟶ ${stage.node.outputType}`));
      if (stage.node.emits) out.push(`      ↳ emite  ${stage.node.emits}`);
      if (stage.compensator) {
        out.push(`      └─(falha !->)─▶ ${box(stage.compensator.name)}  compensação`);
      }
    } else if (stage.kind === "gate") {
      out.push(arrow + box(`?${stage.node.name}  (HITL gate — pausa)`));
      if (stage.node.gateSubject) out.push(`      ↳ pede aprovação em  ${stage.node.gateSubject}`);
    } else {
      out.push(arrow + "┌─(fork)");
      stage.branches.forEach((branch, bi) => {
        const chain = branch
          .map((n) => `${n.name} (${n.inputType}⟶${n.outputType})`)
          .join("  :--:  ");
        out.push(`│  ramo ${bi + 1}${bi === 0 ? " [primário]" : ""}: ${chain}`);
      });
      out.push("└─(join barrier)");
    }
  });

  return out.join("\n");
};

export const renderEdgeTable = (graph: FlowGraph): string => {
  const rows = graph.edges.map(
    (e) => `  ${e.from}  --${e.type}${e.label ? `(${e.label})` : ""}-->  ${e.to}`,
  );
  return ["EDGES", ...rows].join("\n");
};

export const renderMermaid = (graph: FlowGraph): string => {
  const lines: string[] = ["flowchart TD"];
  for (const n of graph.nodes) {
    const shape =
      n.role === "gate" ? `{{"?${n.name}"}}` : n.role === "compensator" ? `[/"${n.name}"/]` : `["${n.name}"]`;
    lines.push(`  ${n.id}${shape}`);
  }
  for (const e of graph.edges) {
    const style = e.type === "saga" ? "-. falha .->" : e.type === "gate" ? "==>" : "-->";
    lines.push(`  ${e.from} ${style}${e.label ? `|${e.label}|` : ""} ${e.to}`);
  }
  return lines.join("\n");
};

export const renderAll = (graph: FlowGraph): string =>
  [renderTopology(graph), "", renderEdgeTable(graph), "", "```mermaid", renderMermaid(graph), "```"].join("\n");
