/**
 * Triage agent — node `TriageComplaint`.
 *
 * Runs the Complaint.classify tool over the (text + transcript) complaint, maps
 * the classification onto the clinical taxonomy and the urgency ladder, and
 * emits `triageCompleted` (+ `crisisDetected` when the escalation lexicon fires,
 * which is what engages the `[?ClinicalReview]` gate).
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import {
  ALL_CONDITIONS,
  CONDITION,
  type Condition,
  type UrgencyKey,
} from "../../config/clinical.js";
import { triageRequestedSchema } from "../domain/events.js";

interface Classification {
  labels: string[];
  dominant: string;
  severityLabels: string[];
  escalated: boolean;
  matchedPhrases: string[];
  rationale: string;
}

const isCondition = (v: string): v is Condition => (ALL_CONDITIONS as readonly string[]).includes(v);

const urgencyFrom = (c: Classification): UrgencyKey => {
  if (c.escalated) return "crisis";
  if (c.severityLabels.includes("priority")) return "priority";
  if (c.severityLabels.includes("elevated")) return "elevated";
  return "routine";
};

export const triageAgent = defineAgent({
  label: AGENT.triage,
  context: CONTEXT_LABEL.triage,
  tools: ["triageClassifier"],
  subscriptions: [
    {
      subject: SUBJECTS.triageRequested,
      queueGroup: CONSUMER_GROUP.triage,
      async handle(raw, ctx) {
        const req = triageRequestedSchema.parse(raw);

        const res = await ctx.invokeTool<{ text: string }, Classification>("triageClassifier", {
          text: req.complaintText,
        });
        if (!res.ok) {
          ctx.logger.error("triage classification failed", { error: res.error });
          await ctx.emit(SUBJECTS.matchingFailed, {
            intakeId: req.intakeId,
            patientId: req.patientId,
            reason: `triage failed: ${res.error.code}`,
          });
          return;
        }

        const c = res.value;
        const conditions = [...new Set(c.labels.filter(isCondition))];
        const list: Condition[] = conditions.length > 0 ? conditions : [CONDITION.desconhecido];
        const dominant: Condition = isCondition(c.dominant) ? c.dominant : list[0]!;
        const urgency = urgencyFrom(c);
        const crisis = c.escalated;

        // Persist the routing facts so the Orchestrator can resume after the gate.
        await ctx.kv.put("flow:triage", req.intakeId, { dominantCondition: dominant, urgency });

        await ctx.emit(SUBJECTS.triageCompleted, {
          intakeId: req.intakeId,
          patientId: req.patientId,
          dominantCondition: dominant,
          conditions: list,
          urgency,
          crisis,
          rationale: c.rationale,
        });

        if (crisis) {
          await ctx.emit(SUBJECTS.crisisDetected, {
            intakeId: req.intakeId,
            patientId: req.patientId,
            matchedPhrases: c.matchedPhrases,
          });
        }
      },
    },
  ],
});
