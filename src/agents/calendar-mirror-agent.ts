/**
 * Calendar mirror agent — Google Calendar as a **data-only, two-way mirror**.
 * The system never renders a calendar.
 *
 *   outbound: consultaScheduled   → upsert a mirrored event
 *             slotHoldReleased     → delete the mirrored event (booking fell through)
 *   inbound:  externalCalendarPollRequested → read the professional's own
 *             calendar, emit externalCalendarEventObserved for every event that
 *             is NOT one of ours (so scheduling can treat it as a busy block).
 *
 * The bearer token is resolved here from the env var named in config and passed
 * to the behaviour — it is never a literal and never read inside a behaviour.
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { PROJECTION } from "../../config/projections.js";
import { GOOGLE_CALENDAR, EVENT_TEMPLATE } from "../../config/calendar.js";
import { SLOT } from "../../config/scheduling.js";
import { formatMoney, money } from "../../config/money.js";
import {
  consultaScheduledSchema,
  slotHoldReleasedSchema,
  externalCalendarPollRequestedSchema,
} from "../domain/events.js";
import type { IntakeRecord } from "./intake-agent.js";

interface MirrorResult {
  action: "created" | "updated" | "deleted" | "noop";
  providerEventId: string;
  externalKey: string;
  simulated: boolean;
}
interface PollResult {
  professionalId: string;
  observed: Array<{ providerEventId: string; summary: string; startIso: string; endIso: string; description: string }>;
  ownEventsSkipped: number;
  nextSyncToken: string;
  simulated: boolean;
}

const token = (): string | undefined =>
  GOOGLE_CALENDAR.live ? process.env[GOOGLE_CALENDAR.tokenEnvVar] : undefined;

const endOfSlot = (startIso: string): string =>
  new Date(new Date(startIso).getTime() + SLOT.durationMinutes * 60_000).toISOString();

export const calendarMirrorAgent = defineAgent({
  label: AGENT.calendarMirror,
  context: CONTEXT_LABEL.calendar,
  tools: ["calendarMirror", "calendarPoller"],
  subscriptions: [
    {
      subject: SUBJECTS.consultaScheduled,
      queueGroup: CONSUMER_GROUP.calendarMirror,
      async handle(raw, ctx) {
        const c = consultaScheduledSchema.parse(raw);
        const rec = await ctx.kv.get<IntakeRecord>(`projection:${PROJECTION.intake}`, c.intakeId);
        const patientName = rec?.patient.displayName ?? "Paciente";
        const conditionDoc = await ctx.kv.get<{ dominantCondition?: string }>("flow:triage", c.intakeId);

        const res = await ctx.invokeTool<
          {
            externalKey: string;
            action: "upsert" | "delete";
            summary: string;
            description: string;
            startIso: string;
            endIso: string;
            attendees: string[];
            bearerToken?: string;
          },
          MirrorResult
        >("calendarMirror", {
          externalKey: c.consultaId,
          action: "upsert",
          summary: EVENT_TEMPLATE.summary({ patientName }),
          description: EVENT_TEMPLATE.description({
            consultaId: c.consultaId,
            condition: conditionDoc?.dominantCondition ?? "geral",
            priceFormatted: formatMoney(money(c.priceCentavos)),
          }),
          startIso: c.scheduledFor,
          endIso: endOfSlot(c.scheduledFor),
          attendees: [],
          ...(token() ? { bearerToken: token()! } : {}),
        });

        if (!res.ok) {
          await ctx.emit(SUBJECTS.calendarMirrorFailed, {
            externalKey: c.consultaId,
            reason: res.error.message,
          });
          return;
        }
        ctx.logger.info("consulta mirrored to google calendar", {
          consultaId: c.consultaId,
          action: res.value.action,
          simulated: res.value.simulated,
        });
        await ctx.emit(SUBJECTS.calendarMirrored, {
          externalKey: c.consultaId,
          action: res.value.action,
          providerEventId: res.value.providerEventId,
          simulated: res.value.simulated,
        });
      },
    },
    {
      subject: SUBJECTS.slotHoldReleased,
      queueGroup: CONSUMER_GROUP.calendarMirror,
      async handle(raw, ctx) {
        const r = slotHoldReleasedSchema.parse(raw);
        const consulta = await ctx.kv.get<{ document: { consultaId?: string } }>(
          `projection:${PROJECTION.consulta}:by-intake`,
          r.intakeId,
        );
        const externalKey = consulta?.document.consultaId ?? `intake:${r.intakeId}`;
        const res = await ctx.invokeTool<
          { externalKey: string; action: "upsert" | "delete"; summary: string; description: string; startIso: string; endIso: string; attendees: string[]; bearerToken?: string },
          MirrorResult
        >("calendarMirror", {
          externalKey,
          action: "delete",
          summary: "",
          description: "",
          startIso: r.slotIso,
          endIso: endOfSlot(r.slotIso),
          attendees: [],
          ...(token() ? { bearerToken: token()! } : {}),
        });
        if (res.ok) {
          await ctx.emit(SUBJECTS.calendarMirrored, {
            externalKey,
            action: res.value.action,
            providerEventId: res.value.providerEventId,
            simulated: res.value.simulated,
          });
        }
      },
    },
    {
      subject: SUBJECTS.externalCalendarPollRequested,
      queueGroup: CONSUMER_GROUP.calendarMirror,
      async handle(raw, ctx) {
        const req = externalCalendarPollRequestedSchema.parse(raw);
        const res = await ctx.invokeTool<
          { professionalId: string; bearerToken?: string; offlineSnapshot?: PollResult["observed"] },
          PollResult
        >("calendarPoller", {
          professionalId: req.professionalId,
          ...(token() ? { bearerToken: token()! } : {}),
          ...(req.offlineSnapshot ? { offlineSnapshot: req.offlineSnapshot } : {}),
        });
        if (!res.ok) {
          ctx.logger.error("external calendar poll failed", { error: res.error });
          return;
        }
        for (const ev of res.value.observed) {
          await ctx.kv.put(`projection:${PROJECTION.externalCalendar}`, ev.providerEventId, {
            document: { professionalId: req.professionalId, ...ev },
            version: 1,
          });
          await ctx.emit(SUBJECTS.externalCalendarEventObserved, {
            professionalId: req.professionalId,
            providerEventId: ev.providerEventId,
            summary: ev.summary,
            startIso: ev.startIso,
            endIso: ev.endIso,
          });
        }
        ctx.logger.info("external calendar observed", {
          professionalId: req.professionalId,
          observed: res.value.observed.length,
          ownSkipped: res.value.ownEventsSkipped,
        });
      },
    },
  ],
});
