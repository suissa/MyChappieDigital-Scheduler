/**
 * Queue agent — node `AssignQueueSlot`.
 *
 * Places the matched patient in the professional's fair queue
 * (QueueEntry.position.assign, priority = urgency rank) and refreshes the queue
 * projection, then emits `queuePositionAssigned`.
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { URGENCY, type UrgencyKey, type Condition } from "../../config/clinical.js";
import { professionalMatchedSchema } from "../domain/events.js";
import { ID } from "../kernel/ids.js";

export const queueAgent = defineAgent({
  label: AGENT.queue,
  context: CONTEXT_LABEL.queue,
  tools: ["queuePositioner", "queueProjectionWriter"],
  subscriptions: [
    {
      subject: SUBJECTS.professionalMatched,
      queueGroup: CONSUMER_GROUP.queue,
      async handle(raw, ctx) {
        const m = professionalMatchedSchema.parse(raw);
        const urgency = m.urgency as UrgencyKey;

        const placed = await ctx.invokeTool<
          { streamKey: string; memberId: string; priorityRank: number },
          { position: number; etaMinutes: number; streamSize: number }
        >("queuePositioner", {
          streamKey: m.professionalId,
          memberId: m.patientId,
          priorityRank: URGENCY[urgency].rank,
        });
        if (!placed.ok) {
          ctx.logger.error("queue positioning failed", { error: placed.error });
          return;
        }

        await ctx.invokeTool<{ key: string; patch: Record<string, unknown> }, { version: number }>(
          "queueProjectionWriter",
          {
            key: m.professionalId,
            patch: {
              professionalId: m.professionalId,
              size: placed.value.streamSize,
              lastPatientId: m.patientId,
              updatedAt: ctx.clock.nowIso(),
            },
          },
        );

        await ctx.emit(SUBJECTS.queuePositionAssigned, {
          queueEntryId: ID.queueEntry(),
          intakeId: m.intakeId,
          patientId: m.patientId,
          professionalId: m.professionalId,
          position: placed.value.position,
          etaMinutes: placed.value.etaMinutes,
          condition: m.condition as Condition,
          urgency,
        });
      },
    },
  ],
});
