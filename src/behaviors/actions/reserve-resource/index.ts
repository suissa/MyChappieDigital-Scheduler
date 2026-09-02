/**
 * AtomicBehaviour: Slot.reserve (generic optimistic resource reservation).
 *
 * Reserves one free key from a named resource pool via the LockPort's
 * compare-and-set. On contention it retries up to `maxAttempts`; if nothing is
 * free it returns an Err — the Saga edge (`!->`) then triggers compensation.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok, err, domainError } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";
import { SUBJECTS } from "../../../../config/subjects.js";
import { newId } from "../../../kernel/ids.js";

const configSchema = z.object({
  poolNamespace: z.string(),
  holdSeconds: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  retryDelayMs: z.number().int().nonnegative(),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  poolId: z.string(),
  /** Ordered candidate resource keys; the first free one wins. */
  candidateKeys: z.array(z.string()).min(1),
  holderRef: z.string(),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  reservationId: z.string(),
  resourceKey: z.string(),
  expiresAtIso: z.string(),
  attempts: z.number().int().positive(),
});
type Output = z.infer<typeof outputSchema>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const reserveResource = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.reserveSlot,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.reservationRequest, output: SEMANTIC_TYPE.reservation },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.scheduling],
      humanInTheLoop: false,
    },
    events: { listen: [SUBJECTS.slotReservationRequested], emit: [SUBJECTS.consultaScheduled] },
    execution: { state: "stateful", sandbox: true, idempotent: false },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    const ns = `${config.poolNamespace}:${input.poolId}`;
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      for (const key of input.candidateKeys) {
        const acquired = await ctx.locks.compareAndSet(ns, key, undefined, input.holderRef);
        if (!acquired) continue;
        const reservationId = newId<"ReservationId">("res");
        const expiresAtIso = new Date(
          ctx.clock.nowMs() + config.holdSeconds * 1000,
        ).toISOString();
        await ctx.kv.put(`${ns}:meta`, key, {
          reservationId,
          holderRef: input.holderRef,
          expiresAtIso,
        });
        return ok({ reservationId, resourceKey: key, expiresAtIso, attempts: attempt });
      }
      if (attempt < config.maxAttempts) await sleep(config.retryDelayMs);
    }
    return err(
      domainError("RESERVATION_EXHAUSTED", "no candidate resource key was free", {
        poolId: input.poolId,
        attempts: config.maxAttempts,
      }),
    );
  },
});
