/**
 * AtomicBehaviour: Projection.record.upsert (generic projection writer).
 *
 * A projection is a derived read model. This behaviour upserts one document into
 * a named projection namespace in the KV port and bumps a monotonic version.
 * Projections are never the source of truth (AGENTS.md §17).
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";

const configSchema = z.object({ projection: z.string() });
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  key: z.string(),
  patch: z.record(z.string(), z.unknown()),
  /** When true, replace the document instead of merging. */
  replace: z.boolean().default(false),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  projection: z.string(),
  key: z.string(),
  version: z.number().int().positive(),
  document: z.record(z.string(), z.unknown()),
});
type Output = z.infer<typeof outputSchema>;

interface Versioned {
  version: number;
  document: Record<string, unknown>;
}

export const recordProjection = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.upsertProjection,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.projectionPatch, output: SEMANTIC_TYPE.projectionVersion },
    invocation: {
      policy: INVOCATION_POLICY.open,
      allowedAgents: [AGENT.queue, AGENT.scheduling, AGENT.matching, AGENT.audit],
      humanInTheLoop: false,
    },
    events: { listen: [], emit: [] },
    execution: { state: "stateful", sandbox: true, idempotent: false },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    const ns = `projection:${config.projection}`;
    const current = await ctx.kv.get<Versioned>(ns, input.key);
    const nextDoc = input.replace
      ? { ...input.patch }
      : { ...(current?.document ?? {}), ...input.patch };
    const version = (current?.version ?? 0) + 1;
    await ctx.kv.put<Versioned>(ns, input.key, { version, document: nextDoc });
    return ok({ projection: config.projection, key: input.key, version, document: nextDoc });
  },
});
