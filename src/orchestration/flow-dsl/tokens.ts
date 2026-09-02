/**
 * Flow-DSL operators as code — the Lucy-mae `docs/2Flow` notation.
 *
 *   A :--: B                 linear sequence (causal dependency)
 *   A !-> Comp               saga step: Comp compensates A on failure
 *   [A, B]                   fork-join (parallel branches, join barrier)
 *   [A, C :--: D]            a branch may itself be a mini-sequence
 *   [?Gate]                  human-in-the-loop governance gate
 */

export const OP = Object.freeze({
  sequence: ":--:",
  saga: "!->",
  forkOpen: "[",
  forkClose: "]",
  branchSep: ",",
  gateMark: "?",
} as const);

export type TokenType =
  | "ident"
  | "sequence"
  | "saga"
  | "fork-open"
  | "fork-close"
  | "branch-sep"
  | "gate-mark";

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly pos: number;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;

export const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  const rest = () => source.slice(i);
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (rest().startsWith(OP.sequence)) {
      tokens.push({ type: "sequence", value: OP.sequence, pos: i });
      i += OP.sequence.length;
      continue;
    }
    if (rest().startsWith(OP.saga)) {
      tokens.push({ type: "saga", value: OP.saga, pos: i });
      i += OP.saga.length;
      continue;
    }
    if (ch === OP.forkOpen) {
      tokens.push({ type: "fork-open", value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === OP.forkClose) {
      tokens.push({ type: "fork-close", value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === OP.branchSep) {
      tokens.push({ type: "branch-sep", value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === OP.gateMark) {
      tokens.push({ type: "gate-mark", value: ch, pos: i });
      i += 1;
      continue;
    }
    const m = IDENT_RE.exec(rest());
    if (m) {
      tokens.push({ type: "ident", value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    throw new SyntaxError(`flow-dsl: unexpected character '${ch}' at ${i}`);
  }
  return tokens;
};
