/**
 * AtomicBehaviour: Governance.approval.request (generic human-in-the-loop gate).
 *
 * Implements the `[?Gate]` operator of the flow DSL. Freezes the flow, emits a
 * governance request on the broker and awaits a human decision (delivered as a
 * broker request/reply). On timeout it falls back to a configured default.
 * The gate is fully auditable: request and decision both traverse UbiQUIC.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";
import { SUBJECTS } from "../../../../config/subjects.js";
import { newId } from "../../../kernel/ids.js";

const configSchema = z.object({
  requestSubject: z.string(),
  timeoutMs: z.number().int().positive(),
  defaultOnTimeout: z.enum(["approved", "rejected"]),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  subjectRef: z.string(),
  question: z.string(),
  context: z.record(z.string(), z.unknown()),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  reviewId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  reviewer: z.string(),
  note: z.string().optional(),
  timedOut: z.boolean(),
});
type Output = z.infer<typeof outputSchema>;

export const requestHumanApproval = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.requestHumanApproval,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.approvalRequest, output: SEMANTIC_TYPE.approvalDecision },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.governance, AGENT.triage],
      humanInTheLoop: true,
    },
    events: {
      listen: [SUBJECTS.clinicalReviewRequested],
      emit: [SUBJECTS.clinicalReviewResolved],
    },
    execution: { state: "stateless", sandbox: true, idempotent: false },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    const reviewId = newId<"ReviewId">("rev");
    try {
      const decision = await ctx.bus.ask<{
        decision: "approved" | "rejected";
        reviewer: string;
        note?: string;
      }>(
        config.requestSubject,
        { reviewId, subjectRef: input.subjectRef, question: input.question, context: input.context },
        config.timeoutMs,
      );
      return ok({
        reviewId,
        decision: decision.decision,
        reviewer: decision.reviewer,
        ...(decision.note ? { note: decision.note } : {}),
        timedOut: false,
      });
    } catch {
      ctx.logger.warn("human approval timed out; applying default", {
        reviewId,
        default: config.defaultOnTimeout,
      });
      return ok({
        reviewId,
        decision: config.defaultOnTimeout,
        reviewer: "system:timeout",
        timedOut: true,
      });
    }
  },
});
