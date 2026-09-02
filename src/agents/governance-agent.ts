/**
 * Governance agent — node `[?ClinicalReview]`.
 *
 * Owns the human-in-the-loop gate. When a crisis is detected it drives the
 * Governance.approval.request tool, which freezes the flow, emits a review
 * request on UbiQUIC and waits for a human decision (request/reply). The
 * outcome is published as `clinicalReviewResolved` for the Orchestrator to act
 * on. The whole gate is auditable — request and decision both traverse the bus.
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { PROJECTION } from "../../config/projections.js";
import { crisisDetectedSchema } from "../domain/events.js";
import type { IntakeRecord } from "./intake-agent.js";

interface GateResult {
  reviewId: string;
  decision: "approved" | "rejected";
  reviewer: string;
  note?: string;
  timedOut: boolean;
}

export const governanceAgent = defineAgent({
  label: AGENT.governance,
  context: CONTEXT_LABEL.governance,
  tools: ["clinicalReviewGate"],
  subscriptions: [
    {
      subject: SUBJECTS.crisisDetected,
      queueGroup: CONSUMER_GROUP.governance,
      async handle(raw, ctx) {
        const crisis = crisisDetectedSchema.parse(raw);
        const record = await ctx.kv.get<IntakeRecord>(
          `projection:${PROJECTION.intake}`,
          crisis.intakeId,
        );

        const res = await ctx.invokeTool<
          { subjectRef: string; question: string; context: Record<string, unknown> },
          GateResult
        >("clinicalReviewGate", {
          subjectRef: crisis.intakeId,
          question: "Liberar agendamento automático para este paciente em crise?",
          context: {
            intakeId: crisis.intakeId,
            patientId: crisis.patientId,
            matchedPhrases: crisis.matchedPhrases,
            complaint: record?.complaintText ?? "(indisponível)",
          },
        });

        if (!res.ok) {
          ctx.logger.error("clinical review gate failed", { error: res.error });
          await ctx.emit(SUBJECTS.clinicalReviewResolved, {
            reviewId: `rev_error`,
            intakeId: crisis.intakeId,
            patientId: crisis.patientId,
            decision: "rejected",
            reviewer: "system:error",
            note: res.error.code,
          });
          return;
        }

        ctx.logger.info("clinical review resolved", {
          decision: res.value.decision,
          reviewer: res.value.reviewer,
          timedOut: res.value.timedOut,
        });
        await ctx.emit(SUBJECTS.clinicalReviewResolved, {
          reviewId: res.value.reviewId,
          intakeId: crisis.intakeId,
          patientId: crisis.patientId,
          decision: res.value.decision,
          reviewer: res.value.reviewer,
          ...(res.value.note ? { note: res.value.note } : {}),
        });
      },
    },
  ],
});
