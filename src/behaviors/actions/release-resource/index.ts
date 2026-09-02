/**
 * AtomicBehaviour: Slot.release (compensation for Slot.reserve).
 *
 * The compensating action on the Saga `!->` edge. Frees a resource key that was
 * held for a holder, idempotently.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";
import { SUBJECTS } from "../../../../config/subjects.js";

const configSchema = z.object({ poolNamespace: z.string() });
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  poolId: z.string(),
  resourceKey: z.string(),
  holderRef: z.string(),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({ released: z.boolean() });
type Output = z.infer<typeof outputSchema>;

export const releaseResource = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.releaseSlot,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.reservation, output: SEMANTIC_TYPE.releaseAck },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.scheduling],
      humanInTheLoop: false,
    },
    events: { listen: [SUBJECTS.slotReservationFailed], emit: [SUBJECTS.slotHoldReleased] },
    execution: { state: "stateful", sandbox: true, idempotent: true },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    const ns = `${config.poolNamespace}:${input.poolId}`;
    const freed = await ctx.locks.compareAndSet(ns, input.resourceKey, input.holderRef, undefined);
    if (freed) await ctx.kv.del(`${ns}:meta`, input.resourceKey);
    return ok({ released: freed });
  },
});
