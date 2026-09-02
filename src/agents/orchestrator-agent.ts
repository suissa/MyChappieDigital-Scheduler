/**
 * Orchestrator agent — the one place the flow is *supervised* rather than
 * choreographed.
 *
 * Choreography can't decide, on its own, whether a triaged intake should go
 * straight to matching or wait behind the `[?ClinicalReview]` gate; and it
 * needs a home for the failure routes. That decision + those routes live here.
 * Everything else in the flow is pure event reaction.
 *
 *   triageCompleted        → matchingRequested        (only when !crisis)
 *   clinicalReviewResolved  → matchingRequested | matchingFailed
 *   matchingFailed          → whatsappDispatchRequested (apology)
 *   slotReservationFailed   → whatsappDispatchRequested (still-looking)
 */

import { defineAgent, type AgentHandlerCtx } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { PROJECTION } from "../../config/projections.js";
import { MESSAGE_TEMPLATE } from "../../config/integrations.js";
import {
  triageCompletedSchema,
  clinicalReviewResolvedSchema,
  matchingFailedSchema,
  slotReservationFailedSchema,
} from "../domain/events.js";
import type { IntakeRecord } from "./intake-agent.js";

const requestMatch = async (
  ctx: AgentHandlerCtx,
  args: { intakeId: string; patientId: string; dominantCondition: string; urgency: string },
): Promise<void> => {
  await ctx.emit(SUBJECTS.matchingRequested, args as never);
};

export const orchestratorAgent = defineAgent({
  label: AGENT.orchestrator,
  context: CONTEXT_LABEL.orchestration,
  tools: [],
  subscriptions: [
    {
      subject: SUBJECTS.triageCompleted,
      queueGroup: CONSUMER_GROUP.governance,
      async handle(raw, ctx) {
        const t = triageCompletedSchema.parse(raw);
        if (t.crisis) {
          ctx.logger.info("crisis intake — holding for clinical review", { intakeId: t.intakeId });
          return;
        }
        await requestMatch(ctx, {
          intakeId: t.intakeId,
          patientId: t.patientId,
          dominantCondition: t.dominantCondition,
          urgency: t.urgency,
        });
      },
    },
    {
      subject: SUBJECTS.clinicalReviewResolved,
      queueGroup: CONSUMER_GROUP.governance,
      async handle(raw, ctx) {
        const r = clinicalReviewResolvedSchema.parse(raw);
        const t = await ctx.kv.get<{ dominantCondition: string; urgency: string }>(
          "flow:triage",
          r.intakeId,
        );
        if (r.decision === "approved") {
          await requestMatch(ctx, {
            intakeId: r.intakeId,
            patientId: r.patientId,
            dominantCondition: t?.dominantCondition ?? "desconhecido",
            urgency: t?.urgency ?? "crisis",
          });
        } else {
          await ctx.emit(SUBJECTS.matchingFailed, {
            intakeId: r.intakeId,
            patientId: r.patientId,
            reason: `clinical review rejected by ${r.reviewer}`,
          });
        }
      },
    },
    {
      subject: SUBJECTS.matchingFailed,
      queueGroup: CONSUMER_GROUP.governance,
      async handle(raw, ctx) {
        const f = matchingFailedSchema.parse(raw);
        const rec = await ctx.kv.get<IntakeRecord>(`projection:${PROJECTION.intake}`, f.intakeId);
        if (!rec) return;
        await ctx.emit(SUBJECTS.whatsappDispatchRequested, {
          to: rec.patient.phone,
          text: MESSAGE_TEMPLATE.matchingFailed(),
          reason: `matching-failed:${f.reason}`,
        });
      },
    },
    {
      subject: SUBJECTS.slotReservationFailed,
      queueGroup: CONSUMER_GROUP.governance,
      async handle(raw, ctx) {
        const f = slotReservationFailedSchema.parse(raw);
        const rec = await ctx.kv.get<IntakeRecord>(`projection:${PROJECTION.intake}`, f.intakeId);
        if (!rec) return;
        await ctx.emit(SUBJECTS.whatsappDispatchRequested, {
          to: rec.patient.phone,
          text: MESSAGE_TEMPLATE.matchingFailed(),
          reason: `slot-reservation-failed:${f.reason}`,
        });
      },
    },
  ],
});
