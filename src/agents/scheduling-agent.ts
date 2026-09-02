/**
 * Scheduling agent — nodes `ReserveConsultaSlot`, `ReleaseSlotHold` (saga
 * compensator) and `RecordConsulta`.
 *
 * Reserves one of the professional's open slots (Slot.reserve, optimistic
 * lock + retry). Success → `consultaScheduled`; exhaustion → `slotReservationFailed`,
 * which this same agent picks up to run the compensator (Slot.release), then
 * `slotHoldReleased`. On a booked consulta it records the consulta projection.
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { PROJECTION } from "../../config/projections.js";
import { PRICE_BOOK } from "../../config/money.js";
import {
  queuePositionAssignedSchema,
  slotReservationFailedSchema,
  consultaScheduledSchema,
} from "../domain/events.js";
import { ID } from "../kernel/ids.js";

export const schedulingAgent = defineAgent({
  label: AGENT.scheduling,
  context: CONTEXT_LABEL.scheduling,
  tools: ["slotReserver", "slotReleaser", "consultaProjectionWriter"],
  subscriptions: [
    {
      subject: SUBJECTS.queuePositionAssigned,
      queueGroup: CONSUMER_GROUP.scheduling,
      async handle(raw, ctx) {
        const q = queuePositionAssignedSchema.parse(raw);
        const professional = ctx.directory.get(q.professionalId);
        const candidateKeys = [...(professional?.openSlots ?? [])].sort();
        if (candidateKeys.length === 0) {
          await ctx.emit(SUBJECTS.slotReservationFailed, {
            intakeId: q.intakeId,
            patientId: q.patientId,
            professionalId: q.professionalId,
            slotIso: ctx.clock.nowIso(),
            reason: "professional has no open slot at reservation time",
            attempts: 1,
          });
          return;
        }

        const reserved = await ctx.invokeTool<
          { poolId: string; candidateKeys: string[]; holderRef: string },
          { reservationId: string; resourceKey: string; expiresAtIso: string; attempts: number }
        >("slotReserver", {
          poolId: q.professionalId,
          candidateKeys,
          holderRef: q.intakeId,
        });

        if (!reserved.ok) {
          await ctx.emit(SUBJECTS.slotReservationFailed, {
            intakeId: q.intakeId,
            patientId: q.patientId,
            professionalId: q.professionalId,
            slotIso: candidateKeys[0]!,
            reason: reserved.error.message,
            attempts:
              typeof reserved.error.details?.["attempts"] === "number"
                ? (reserved.error.details["attempts"] as number)
                : 1,
          });
          return;
        }

        ctx.directory.consumeSlot(q.professionalId, reserved.value.resourceKey);
        ctx.directory.incrementLoad(q.professionalId);

        await ctx.emit(SUBJECTS.consultaScheduled, {
          consultaId: ID.consulta(),
          intakeId: q.intakeId,
          patientId: q.patientId,
          professionalId: q.professionalId,
          slotId: reserved.value.reservationId,
          scheduledFor: reserved.value.resourceKey,
          priceCentavos: PRICE_BOOK.consultaBase,
        });
      },
    },
    {
      subject: SUBJECTS.slotReservationFailed,
      queueGroup: CONSUMER_GROUP.scheduling,
      async handle(raw, ctx) {
        const f = slotReservationFailedSchema.parse(raw);
        const released = await ctx.invokeTool<
          { poolId: string; resourceKey: string; holderRef: string },
          { released: boolean }
        >("slotReleaser", {
          poolId: f.professionalId,
          resourceKey: f.slotIso,
          holderRef: f.intakeId,
        });
        ctx.logger.info("saga compensation ran", {
          intakeId: f.intakeId,
          released: released.ok ? released.value.released : false,
        });
        await ctx.emit(SUBJECTS.slotHoldReleased, {
          intakeId: f.intakeId,
          professionalId: f.professionalId,
          slotIso: f.slotIso,
        });
      },
    },
    {
      subject: SUBJECTS.consultaScheduled,
      queueGroup: CONSUMER_GROUP.scheduling,
      async handle(raw, ctx) {
        const c = consultaScheduledSchema.parse(raw);
        await ctx.invokeTool<{ key: string; patch: Record<string, unknown> }, { version: number }>(
          "consultaProjectionWriter",
          {
            key: c.patientId,
            patch: {
              consultaId: c.consultaId,
              intakeId: c.intakeId,
              professionalId: c.professionalId,
              scheduledFor: c.scheduledFor,
              priceCentavos: c.priceCentavos,
              slotId: c.slotId,
            },
          },
        );
        await ctx.kv.put(`projection:${PROJECTION.consulta}:by-intake`, c.intakeId, c);
        await ctx.emit(SUBJECTS.consultaProjectionUpdated, {
          consultaId: c.consultaId,
          patientId: c.patientId,
          professionalId: c.professionalId,
          scheduledFor: c.scheduledFor,
        });
      },
    },
  ],
});
