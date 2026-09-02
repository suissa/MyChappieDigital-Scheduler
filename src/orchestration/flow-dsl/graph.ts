/**
 * Flow graph — the AST plus a node binding for every referenced name, turned
 * into an executable, checkable topology.
 *
 * A `NodeBinding` connects a DSL node name to the Tool that realises it and to
 * its semantic flow types (`config/semantic-types.ts`). The graph exposes:
 *   - `nodes`    every node with its resolved types and role
 *   - `edges`    sequence / saga / fork / join / gate edges (for rendering + checks)
 *   - `stages`   the linear execution plan
 */

import type { SemanticType } from "../../../config/semantic-types.js";
import type { ToolName } from "../../tools/catalog.js";
import {
  flowNodeNames,
  type FlowAst,
  type Segment,
  type StepSegment,
} from "./parser.js";

export type NodeRole = "action" | "compensator" | "gate";

export interface NodeBinding {
  readonly role: NodeRole;
  /** Which catalog Tool realises this node. Absent only for pure control nodes. */
  readonly tool?: ToolName;
  readonly inputType: SemanticType;
  readonly outputType: SemanticType;
  /** Choreography: the subject whose arrival triggers this node. */
  readonly listens?: string;
  /** The fact emitted when this node succeeds. */
  readonly emits?: string;
  /** For a gate: the governance request subject. */
  readonly gateSubject?: string;
}

export type FlowBindings = Readonly<Record<string, NodeBinding>>;

export interface GraphNode extends NodeBinding {
  readonly id: string;
  readonly name: string;
}

export type EdgeType = "sequence" | "saga" | "fork" | "join" | "gate";

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly type: EdgeType;
  readonly label?: string;
}

export interface ActionStage {
  readonly kind: "action";
  readonly node: GraphNode;
  readonly compensator?: GraphNode;
}
export interface ForkJoinStage {
  readonly kind: "fork-join";
  readonly branches: readonly (readonly GraphNode[])[];
}
export interface GateStage {
  readonly kind: "gate";
  readonly node: GraphNode;
}
export type Stage = ActionStage | ForkJoinStage | GateStage;

export interface FlowGraph {
  readonly source: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly stages: readonly Stage[];
  readonly entryType: SemanticType;
  readonly exitType: SemanticType;
}

export class FlowBindingError extends Error {}

const resolve = (name: string, role: NodeRole, bindings: FlowBindings): GraphNode => {
  const b = bindings[name];
  if (!b) throw new FlowBindingError(`flow-dsl: no binding for node '${name}'`);
  if (b.role !== role) {
    throw new FlowBindingError(
      `flow-dsl: node '${name}' is bound as '${b.role}' but used as '${role}'`,
    );
  }
  return { ...b, id: name, name };
};

const firstNode = (stage: Stage): GraphNode =>
  stage.kind === "fork-join" ? stage.branches[0]![0]! : stage.node;

const lastNodes = (stage: Stage): GraphNode[] =>
  stage.kind === "fork-join"
    ? stage.branches.map((br) => br[br.length - 1]!)
    : [stage.node];

export const buildGraph = (ast: FlowAst, bindings: FlowBindings): FlowGraph => {
  // Every referenced name must be bound.
  const missing = flowNodeNames(ast).filter((n) => !bindings[n]);
  if (missing.length > 0) {
    throw new FlowBindingError(`flow-dsl: unbound nodes: ${missing.join(", ")}`);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const stages: Stage[] = [];
  const seen = new Set<string>();
  const addNode = (n: GraphNode): void => {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      nodes.push(n);
    }
  };

  const stageFor = (seg: Segment): Stage => {
    if (seg.kind === "gate") {
      const node = resolve(seg.name, "gate", bindings);
      addNode(node);
      return { kind: "gate", node };
    }
    if (seg.kind === "step") {
      const node = resolve(seg.action, "action", bindings);
      addNode(node);
      if (seg.compensator) {
        const comp = resolve(seg.compensator, "compensator", bindings);
        addNode(comp);
        edges.push({ from: node.id, to: comp.id, type: "saga", label: "on failure" });
        return { kind: "action", node, compensator: comp };
      }
      return { kind: "action", node };
    }
    const branches = seg.branches.map((branch: readonly StepSegment[]) =>
      branch.map((step) => {
        const n = resolve(step.action, "action", bindings);
        addNode(n);
        if (step.compensator) {
          const comp = resolve(step.compensator, "compensator", bindings);
          addNode(comp);
          edges.push({ from: n.id, to: comp.id, type: "saga", label: "on failure" });
        }
        return n;
      }),
    );
    // intra-branch sequence edges
    for (const br of branches) {
      for (let i = 0; i + 1 < br.length; i++) {
        edges.push({ from: br[i]!.id, to: br[i + 1]!.id, type: "sequence" });
      }
    }
    return { kind: "fork-join", branches };
  };

  for (const seg of ast.segments) stages.push(stageFor(seg));

  // inter-stage edges
  for (let i = 0; i + 1 < stages.length; i++) {
    const cur = stages[i]!;
    const nxt = stages[i + 1]!;
    const targets = nxt.kind === "fork-join" ? nxt.branches.map((b) => b[0]!) : [firstNode(nxt)];
    const sources = lastNodes(cur);
    for (const s of sources) {
      for (const t of targets) {
        const type: EdgeType =
          cur.kind === "fork-join" ? "join" : nxt.kind === "fork-join" ? "fork" : "sequence";
        edges.push({ from: s.id, to: t.id, type });
      }
    }
  }

  const entry = firstNode(stages[0]!);
  const exit = lastNodes(stages[stages.length - 1]!)[0]!;

  return {
    source: ast.source,
    nodes,
    edges,
    stages,
    entryType: entry.inputType,
    exitType: exit.outputType,
  };
};
