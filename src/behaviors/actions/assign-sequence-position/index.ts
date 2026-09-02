/**
 * AtomicBehaviour: QueueEntry.position.assign (generic fair-sequence placement).
 *
 * Maintains an ordered list per `streamKey` in the KV port and returns the
 * position + ETA for a member, honouring a `priorityRank` (higher rank inserts
 * ahead of lower-rank members but never ahead of same-or-higher rank ones).
 * Stateful, idempotent per (streamKey, memberId).
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";
import { SUBJECTS } from "../../../../config/subjects.js";

const configSchema = z.object({
  namespace: z.string(),
  firstPosition: z.number().int(),
  unitMinutes: z.number().nonnegative(),
  maxTracked: z.number().int().positive(),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  streamKey: z.string(),
  memberId: z.string(),
  priorityRank: z.number().int().nonnegative(),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  position: z.number().int().positive(),
  etaMinutes: z.number().nonnegative(),
  streamSize: z.number().int().positive(),
});
type Output = z.infer<typeof outputSchema>;

interface Member {
  id: string;
  rank: number;
}

export const assignSequencePosition = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.assignQueuePosition,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.queueInsertRequest, output: SEMANTIC_TYPE.queuePlacement },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.queue],
      humanInTheLoop: false,
    },
    events: { listen: [SUBJECTS.professionalMatched], emit: [SUBJECTS.queuePositionAssigned] },
    execution: { state: "stateful", sandbox: true, idempotent: true },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    const existing = (await ctx.kv.get<Member[]>(config.namespace, input.streamKey)) ?? [];
    let list = existing.filter((m) => m.id !== input.memberId);

    // Insert ahead of the first strictly-lower-rank member.
    const insertAt = list.findIndex((m) => m.rank < input.priorityRank);
    const idx = insertAt === -1 ? list.length : insertAt;
    list = [...list.slice(0, idx), { id: input.memberId, rank: input.priorityRank }, ...list.slice(idx)];
    if (list.length > config.maxTracked) list = list.slice(0, config.maxTracked);

    await ctx.kv.put(config.namespace, input.streamKey, list);

    const zeroBased = list.findIndex((m) => m.id === input.memberId);
    const position = config.firstPosition + zeroBased;
    return ok({
      position,
      etaMinutes: zeroBased * config.unitMinutes,
      streamSize: list.length,
    });
  },
});
