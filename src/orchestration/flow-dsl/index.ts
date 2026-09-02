/** Flow-DSL public surface. */

export { OP, tokenize, type Token, type TokenType } from "./tokens.js";
export {
  parseFlow,
  flowNodeNames,
  type FlowAst,
  type Segment,
  type StepSegment,
  type ForkJoinSegment,
  type GateSegment,
} from "./parser.js";
export {
  buildGraph,
  FlowBindingError,
  type FlowGraph,
  type FlowBindings,
  type GraphNode,
  type GraphEdge,
  type NodeBinding,
  type NodeRole,
  type Stage,
  type ActionStage,
  type ForkJoinStage,
  type GateStage,
} from "./graph.js";
export {
  typecheckGraph,
  type TypeCheckResult,
  type TypeViolation,
} from "./typecheck.js";
export {
  renderTopology,
  renderEdgeTable,
  renderMermaid,
  renderAll,
} from "./render.js";

import { parseFlow } from "./parser.js";
import { buildGraph, type FlowBindings, type FlowGraph } from "./graph.js";
import { typecheckGraph } from "./typecheck.js";

/** Parse + bind + type-check in one step. Throws if the graph does not type. */
export const compileFlow = (source: string, bindings: FlowBindings): FlowGraph => {
  const graph = buildGraph(parseFlow(source), bindings);
  const check = typecheckGraph(graph);
  if (!check.ok) {
    throw new Error(`flow-dsl: type contract violated\n${check.report}`);
  }
  return graph;
};
