/**
 * `npm run flow:render` — compile every declared flow and print its topology,
 * edge table, Mermaid source and type-contract report.
 */

import { parseFlow, buildGraph, typecheckGraph, renderAll } from "../flow-dsl/index.js";
import {
  CONSULTA_SCHEDULING_DSL,
  CONSULTA_SCHEDULING_BINDINGS,
} from "./consulta-scheduling.flow.js";
import {
  TRANSCRIPT_CORRECTION_DSL,
  TRANSCRIPT_CORRECTION_BINDINGS,
} from "./transcript-correction.flow.js";

const FLOWS = [
  { name: "consulta-scheduling", dsl: CONSULTA_SCHEDULING_DSL, bindings: CONSULTA_SCHEDULING_BINDINGS },
  { name: "transcript-correction", dsl: TRANSCRIPT_CORRECTION_DSL, bindings: TRANSCRIPT_CORRECTION_BINDINGS },
] as const;

let failures = 0;
for (const flow of FLOWS) {
  const graph = buildGraph(parseFlow(flow.dsl), flow.bindings);
  const check = typecheckGraph(graph);
  process.stdout.write(`\n${"═".repeat(74)}\nFLOW: ${flow.name}\n${"═".repeat(74)}\n`);
  process.stdout.write(renderAll(graph) + "\n\n");
  process.stdout.write(check.report + "\n");
  if (!check.ok) failures += 1;
}
process.exit(failures === 0 ? 0 : 1);
