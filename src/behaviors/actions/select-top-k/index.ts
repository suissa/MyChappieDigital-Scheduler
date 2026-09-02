/**
 * AtomicBehaviour: Candidate.rank.topK (generic ranker/selector).
 *
 * Takes a scored set, returns the top `k` above `minScore`. Pure and generic.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok, err, domainError } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";

const configSchema = z.object({ k: z.number().int().positive(), minScore: z.number() });
type Config = z.infer<typeof configSchema>;

const scored = z.object({ id: z.string(), score: z.number(), components: z.record(z.string(), z.number()).optional() });
const inputSchema = z.object({ scored: z.array(scored) });
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  selected: z.array(scored),
  rejectedCount: z.number().int().nonnegative(),
  best: scored.optional(),
});
type Output = z.infer<typeof outputSchema>;

export const selectTopK = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.rankCandidates,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.scoredCandidateSet, output: SEMANTIC_TYPE.ranking },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.matching],
      humanInTheLoop: false,
    },
    events: { listen: [], emit: [] },
    execution: { state: "stateless", sandbox: true, idempotent: true },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(_ctx, config, input) {
    const ranked = [...input.scored].sort((a, b) => b.score - a.score);
    const viable = ranked.filter((c) => c.score >= config.minScore);
    const selected = viable.slice(0, config.k);
    if (selected.length === 0) {
      return err(domainError("NO_VIABLE_CANDIDATE", "no candidate cleared minScore", { minScore: config.minScore }));
    }
    return ok({
      selected,
      rejectedCount: ranked.length - selected.length,
      best: selected[0],
    });
  },
});
