/**
 * Notification agent — node `NotifyPatient` + the ad-hoc dispatch route.
 *
 * On a persisted consulta it composes the confirmation from the message
 * templates and drives Whatsapp.message.dispatch. It also serves generic
 * `whatsappDispatchRequested` commands from the Orchestrator.
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { PROJECTION } from "../../config/projections.js";
import { MESSAGE_TEMPLATE } from "../../config/integrations.js";
import {
  consultaProjectionUpdatedSchema,
  whatsappDispatchRequestedSchema,
} from "../domain/events.js";
import type { IntakeRecord } from "./intake-agent.js";

interface Receipt {
  providerMessageId: string;
  simulated: boolean;
  transport: "whatsapp";
}

export const notificationAgent = defineAgent({
  label: AGENT.notification,
  context: CONTEXT_LABEL.notification,
  tools: ["whatsappDispatcher"],
  subscriptions: [
    {
      subject: SUBJECTS.consultaProjectionUpdated,
      queueGroup: CONSUMER_GROUP.notification,
      async handle(raw, ctx) {
        const c = consultaProjectionUpdatedSchema.parse(raw);
        const consultaDoc = await ctx.kv.get<{ document: { intakeId: string } }>(
          `projection:${PROJECTION.consulta}`,
          c.patientId,
        );
        const record = consultaDoc
          ? await ctx.kv.get<IntakeRecord>(
              `projection:${PROJECTION.intake}`,
              consultaDoc.document.intakeId,
            )
          : undefined;
        const professional = ctx.directory.get(c.professionalId);
        const queueDoc = await ctx.kv.get<{ document?: { size?: number } }>(
          `projection:${PROJECTION.queue}`,
          c.professionalId,
        );

        const phone = record?.patient.phone;
        if (!phone) {
          ctx.logger.warn("no patient contact for confirmation", { patientId: c.patientId });
          return;
        }

        const text = MESSAGE_TEMPLATE.consultaScheduled({
          professionalName: professional?.displayName ?? "seu profissional",
          whenIso: c.scheduledFor,
          position: queueDoc?.document?.size ?? 1,
        });

        const res = await ctx.invokeTool<{ to: string; text: string }, Receipt>("whatsappDispatcher", {
          to: phone,
          text,
        });
        if (!res.ok) {
          ctx.logger.error("confirmation dispatch failed", { error: res.error });
          return;
        }
        await ctx.emit(SUBJECTS.whatsappDispatched, {
          to: phone,
          text,
          providerMessageId: res.value.providerMessageId,
          simulated: res.value.simulated,
        });
      },
    },
    {
      subject: SUBJECTS.whatsappDispatchRequested,
      queueGroup: CONSUMER_GROUP.notification,
      async handle(raw, ctx) {
        const req = whatsappDispatchRequestedSchema.parse(raw);
        const res = await ctx.invokeTool<{ to: string; text: string }, Receipt>("whatsappDispatcher", {
          to: req.to,
          text: req.text,
        });
        if (!res.ok) {
          ctx.logger.error("dispatch failed", { error: res.error, reason: req.reason });
          return;
        }
        await ctx.emit(SUBJECTS.whatsappDispatched, {
          to: req.to,
          text: req.text,
          providerMessageId: res.value.providerMessageId,
          simulated: res.value.simulated,
        });
      },
    },
  ],
});
