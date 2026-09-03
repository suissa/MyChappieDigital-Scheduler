/**
 * AtomicBehaviour: Calendar.external.poll (inbound mirror).
 *
 * Reads events the professional added directly in Google Calendar and returns
 * the ones that are NOT ours (no system tag) as observed busy blocks. Offline
 * it replays a caller-supplied snapshot so the inbound mirror is testable.
 * Idempotent via `syncToken`.
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
  systemTag: z.string(),
  stateNamespace: z.string(),
});
type Config = z.infer<typeof configSchema>;

const externalEvent = z.object({
  providerEventId: z.string(),
  summary: z.string(),
  startIso: z.string(),
  endIso: z.string(),
  description: z.string().default(""),
});

const inputSchema = z.object({
  professionalId: z.string(),
  bearerToken: z.string().optional(),
  /** Deterministic replay for offline runs / tests. */
  offlineSnapshot: z.array(externalEvent).optional(),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  professionalId: z.string(),
  observed: z.array(externalEvent),
  ownEventsSkipped: z.number().int().nonnegative(),
  nextSyncToken: z.string(),
  simulated: z.boolean(),
});
type Output = z.infer<typeof outputSchema>;

export const pollExternalCalendar = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.pollExternalCalendar,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.externalCalendarSnapshot, output: SEMANTIC_TYPE.observedExternalEvents },
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
    const priorToken = await ctx.kv.get<string>(config.stateNamespace, `${input.professionalId}:syncToken`);

    let items: z.infer<typeof externalEvent>[];
    let simulated: boolean;

    if (!config.live) {
      items = input.offlineSnapshot ?? [];
      simulated = true;
    } else {
      const res = await ctx.http.request({
        method: "GET",
        url:
          `${config.baseUrl}/calendars/${encodeURIComponent(config.calendarId)}/events` +
          (priorToken ? `?syncToken=${encodeURIComponent(priorToken)}` : "?maxResults=50&singleEvents=true"),
        headers: input.bearerToken ? { authorization: `Bearer ${input.bearerToken}` } : {},
      });
      if (res.status >= 400) {
        return err(domainError("CALENDAR_POLL_FAILED", `google responded ${res.status}`, { body: res.json }));
      }
      const body = res.json as {
        items?: Array<{ id?: string; summary?: string; description?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }>;
        nextSyncToken?: string;
      };
      items = (body.items ?? []).map((e) => ({
        providerEventId: String(e.id ?? ""),
        summary: String(e.summary ?? ""),
        startIso: String(e.start?.dateTime ?? ""),
        endIso: String(e.end?.dateTime ?? ""),
        description: String(e.description ?? ""),
      }));
      simulated = false;
      await ctx.kv.put(config.stateNamespace, `${input.professionalId}:syncToken`, body.nextSyncToken ?? "");
    }

    const own = items.filter((e) => e.description.includes(config.systemTag));
    const observed = items.filter((e) => !e.description.includes(config.systemTag));

    return ok({
      professionalId: input.professionalId,
      observed,
      ownEventsSkipped: own.length,
      nextSyncToken:
        (await ctx.kv.get<string>(config.stateNamespace, `${input.professionalId}:syncToken`)) ?? "",
      simulated,
    });
  },
});
