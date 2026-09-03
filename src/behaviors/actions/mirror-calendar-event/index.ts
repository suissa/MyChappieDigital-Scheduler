/**
 * AtomicBehaviour: Calendar.event.mirror (outbound, idempotent).
 *
 * Writes / updates / deletes one calendar event that mirrors a system fact
 * (a consulta). Keyed by our own `externalKey` (the consultaId) via an
 * extended property, so re-running is a no-op or an update — never a duplicate.
 * The calendar is never shown to anyone; this is pure data replication.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok, err, domainError } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";

const configSchema = z.object({
  provider: z.literal("google"),
  live: z.boolean().default(false),
  baseUrl: z.string().url(),
  calendarId: z.string(),
  tokenEnvVar: z.string(),
  timezone: z.string(),
  systemTag: z.string(),
  correlationPropertyKey: z.string(),
  /** KV namespace holding our mirror state, keyed by externalKey. */
  stateNamespace: z.string(),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  externalKey: z.string(),
  action: z.enum(["upsert", "delete"]),
  summary: z.string(),
  description: z.string(),
  startIso: z.string(),
  endIso: z.string(),
  attendees: z.array(z.string()).default([]),
  /** Resolved by the agent from the env var named in config; never a literal. */
  bearerToken: z.string().optional(),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  action: z.enum(["created", "updated", "deleted", "noop"]),
  providerEventId: z.string(),
  externalKey: z.string(),
  simulated: z.boolean(),
});
type Output = z.infer<typeof outputSchema>;

interface MirrorState {
  providerEventId: string;
  lastHash: string;
}

const hash = (i: Input): string =>
  `${i.summary}|${i.description}|${i.startIso}|${i.endIso}|${i.attendees.join(",")}`;

export const mirrorCalendarEvent = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.mirrorCalendarEvent,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.calendarMirrorRequest, output: SEMANTIC_TYPE.calendarMirrorResult },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.calendarMirror],
      humanInTheLoop: false,
    },
    events: { listen: [], emit: [] },
    execution: { state: "stateful", sandbox: true, idempotent: true },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    const prior = await ctx.kv.get<MirrorState>(config.stateNamespace, input.externalKey);

    // Offline / not-live: keep the mirror state locally, report the action.
    const simulate = !config.live;

    if (input.action === "delete") {
      if (!prior) return ok({ action: "noop", providerEventId: "", externalKey: input.externalKey, simulated: simulate });
      if (!simulate) {
        await ctx.http.request({
          method: "DELETE",
          url: `${config.baseUrl}/calendars/${encodeURIComponent(config.calendarId)}/events/${prior.providerEventId}`,
          headers: authHeaders(input.bearerToken),
        });
      }
      await ctx.kv.del(config.stateNamespace, input.externalKey);
      return ok({ action: "deleted", providerEventId: prior.providerEventId, externalKey: input.externalKey, simulated: simulate });
    }

    const nextHash = hash(input);
    if (prior && prior.lastHash === nextHash) {
      return ok({ action: "noop", providerEventId: prior.providerEventId, externalKey: input.externalKey, simulated: simulate });
    }

    const eventBody = {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startIso, timeZone: config.timezone },
      end: { dateTime: input.endIso, timeZone: config.timezone },
      attendees: input.attendees.map((email) => ({ email })),
      extendedProperties: { private: { [config.correlationPropertyKey]: input.externalKey } },
    };

    let providerEventId = prior?.providerEventId ?? `sim_${input.externalKey}`;
    if (!simulate) {
      const res = prior
        ? await ctx.http.request({
            method: "PATCH",
            url: `${config.baseUrl}/calendars/${encodeURIComponent(config.calendarId)}/events/${prior.providerEventId}`,
            headers: authHeaders(input.bearerToken),
            body: eventBody,
          })
        : await ctx.http.request({
            method: "POST",
            url: `${config.baseUrl}/calendars/${encodeURIComponent(config.calendarId)}/events`,
            headers: authHeaders(input.bearerToken),
            body: eventBody,
          });
      if (res.status >= 400) {
        return err(domainError("CALENDAR_MIRROR_FAILED", `google responded ${res.status}`, { body: res.json }));
      }
      providerEventId = String((res.json as { id?: string }).id ?? providerEventId);
    }

    await ctx.kv.put<MirrorState>(config.stateNamespace, input.externalKey, {
      providerEventId,
      lastHash: nextHash,
    });
    return ok({
      action: prior ? "updated" : "created",
      providerEventId,
      externalKey: input.externalKey,
      simulated: simulate,
    });
  },
});

const authHeaders = (bearerToken: string | undefined): Record<string, string> => ({
  "content-type": "application/json",
  ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
});
