/**
 * Flow-DSL parser — turns the Lucy-mae 2Flow string into an AST.
 *
 * Grammar (v1):
 *   flow      := segment (":--:" segment)*
 *   segment   := forkjoin | gate | step
 *   step      := IDENT ("!->" IDENT)?          // a step with an optional compensator
 *   forkjoin  := "[" branch ("," branch)* "]"
 *   branch    := step (":--:" step)*           // a mini-sequence, no nested fork/gate
 *   gate      := "[" "?" IDENT "]"
 *
 * `!->` binds tighter than `:--:` so `A !-> B :--: C` parses as `(A !-> B) :--: C`.
 */

import { tokenize, type Token } from "./tokens.js";

export interface StepSegment {
  readonly kind: "step";
  readonly action: string;
  readonly compensator?: string;
}

export interface ForkJoinSegment {
  readonly kind: "fork-join";
  readonly branches: readonly (readonly StepSegment[])[];
}

export interface GateSegment {
  readonly kind: "gate";
  readonly name: string;
}

export type Segment = StepSegment | ForkJoinSegment | GateSegment;

export interface FlowAst {
  readonly source: string;
  readonly segments: readonly Segment[];
}

class Cursor {
  #tokens: Token[];
  #i = 0;
  constructor(tokens: Token[]) {
    this.#tokens = tokens;
  }
  peek(): Token | undefined {
    return this.#tokens[this.#i];
  }
  next(): Token {
    const t = this.#tokens[this.#i];
    if (!t) throw new SyntaxError("flow-dsl: unexpected end of input");
    this.#i += 1;
    return t;
  }
  eof(): boolean {
    return this.#i >= this.#tokens.length;
  }
  expect(type: Token["type"]): Token {
    const t = this.next();
    if (t.type !== type) {
      throw new SyntaxError(`flow-dsl: expected ${type} but got '${t.value}' at ${t.pos}`);
    }
    return t;
  }
}

const parseStep = (c: Cursor): StepSegment => {
  const action = c.expect("ident").value;
  if (c.peek()?.type === "saga") {
    c.next();
    const compensator = c.expect("ident").value;
    return { kind: "step", action, compensator };
  }
  return { kind: "step", action };
};

const parseBranch = (c: Cursor): StepSegment[] => {
  const steps: StepSegment[] = [parseStep(c)];
  while (c.peek()?.type === "sequence") {
    c.next();
    steps.push(parseStep(c));
  }
  return steps;
};

const parseBracket = (c: Cursor): ForkJoinSegment | GateSegment => {
  c.expect("fork-open");
  if (c.peek()?.type === "gate-mark") {
    c.next();
    const name = c.expect("ident").value;
    c.expect("fork-close");
    return { kind: "gate", name };
  }
  const branches: StepSegment[][] = [parseBranch(c)];
  while (c.peek()?.type === "branch-sep") {
    c.next();
    branches.push(parseBranch(c));
  }
  c.expect("fork-close");
  return { kind: "fork-join", branches };
};

const parseSegment = (c: Cursor): Segment => {
  const t = c.peek();
  if (!t) throw new SyntaxError("flow-dsl: expected a segment");
  if (t.type === "fork-open") return parseBracket(c);
  if (t.type === "ident") return parseStep(c);
  throw new SyntaxError(`flow-dsl: unexpected token '${t.value}' at ${t.pos}`);
};

export const parseFlow = (source: string): FlowAst => {
  const c = new Cursor(tokenize(source));
  const segments: Segment[] = [parseSegment(c)];
  while (!c.eof()) {
    c.expect("sequence");
    segments.push(parseSegment(c));
  }
  return { source: source.trim(), segments };
};

/** Every distinct node name referenced by the flow (actions, compensators, gates). */
export const flowNodeNames = (ast: FlowAst): string[] => {
  const names = new Set<string>();
  for (const seg of ast.segments) {
    if (seg.kind === "step") {
      names.add(seg.action);
      if (seg.compensator) names.add(seg.compensator);
    } else if (seg.kind === "gate") {
      names.add(seg.name);
    } else {
      for (const branch of seg.branches) {
        for (const step of branch) {
          names.add(step.action);
          if (step.compensator) names.add(step.compensator);
        }
      }
    }
  }
  return [...names];
};
