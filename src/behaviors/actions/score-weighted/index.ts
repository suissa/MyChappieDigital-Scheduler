/**
 * AtomicBehaviour: Professional.affinity.score (generic weighted scorer).
 *
 * Given candidates with named numeric features (0..1) and named penalty counts,
 * produce a weighted score per candidate. Weights and penalties are basis
 * points. Nothing here is clinical — the Matching agent binds it with the
 * `config/scheduling.ts` weights.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";
import { SUBJECTS } from "../../../../config/subjects.js";

const configSchema = z.object({
  weightsBps: z.record(z.string(), z.number().nonnegative()),
  penaltyBps: z.record(z.string(), z.number().nonnegative()),
  totalBps: z.number().positive(),
});
type Config = z.infer<typeof configSchema>;

const candidate = z.object({
  id: z.string(),
  features: z.record(z.string(), z.number()),
  penaltyCounts: z.record(z.string(), z.number().nonnegative()).default({}),
});
const inputSchema = z.object({ candidates: z.array(candidate) });
type Input = z.infer<typeof inputSchema>;

const scored = z.object({
  id: z.string(),
  score: z.number(),
  components: z.record(z.string(), z.number()),
});
const outputSchema = z.object({ scored: z.array(scored) });
type Output = z.infer<typeof outputSchema>;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export const scoreWeighted = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.scoreAffinity,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.candidateFeatureSet, output: SEMANTIC_TYPE.scoredCandidateSet },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.matching],
      humanInTheLoop: false,
    },
    events: { listen: [SUBJECTS.matchingRequested], emit: [] },
    execution: { state: "stateless", sandbox: true, idempotent: true },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(_ctx, config, input) {
    const out = input.candidates.map((c) => {
      const components: Record<string, number> = {};
      let weighted = 0;
      for (const [feature, bps] of Object.entries(config.weightsBps)) {
        const value = clamp01(c.features[feature] ?? 0);
        const contribution = (value * bps) / config.totalBps;
        components[feature] = Number(contribution.toFixed(6));
        weighted += contribution;
      }
      let penalty = 0;
      for (const [name, bps] of Object.entries(config.penaltyBps)) {
        const count = c.penaltyCounts[name] ?? 0;
        const p = (count * bps) / config.totalBps;
        components[`penalty:${name}`] = Number((-p).toFixed(6));
        penalty += p;
      }
      return { id: c.id, score: Number((weighted - penalty).toFixed(6)), components };
    });
    out.sort((a, b) => b.score - a.score);
    return ok({ scored: out });
  },
});
