/**
 * Event/command envelope (AGENTS.md §16, §25).
 *
 * Every message on UbiQUIC carries: canonical subject, schema version, producer
 * (actor), context, timestamp, correlation id and causation id. The payload is
 * validated against the domain schema for that subject before an agent sees it.
 */

import { z } from "zod";
import { ID, type CausationId, type CorrelationId, type EventId } from "../kernel/ids.js";
import type { Clock } from "../kernel/clock.js";

export const envelopeMetaSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  kind: z.enum(["event", "command"]),
  schemaVersion: z.string().min(1),
  occurredAt: z.string().datetime(),
  producer: z.string().min(1),
  context: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().min(1),
});
export type EnvelopeMeta = z.infer<typeof envelopeMetaSchema>;

export interface Envelope<T> {
  readonly meta: EnvelopeMeta;
  readonly payload: T;
}

export interface NewEnvelopeArgs<T> {
  subject: string;
  kind: "event" | "command";
  schemaVersion: string;
  producer: string;
  context: string;
  correlationId: CorrelationId;
  causationId: CausationId;
  payload: T;
}

export const makeEnvelope = <T>(args: NewEnvelopeArgs<T>, clock: Clock): Envelope<T> => ({
  meta: {
    id: ID.event() as EventId,
    subject: args.subject,
    kind: args.kind,
    schemaVersion: args.schemaVersion,
    occurredAt: clock.nowIso(),
    producer: args.producer,
    context: args.context,
    correlationId: args.correlationId,
    causationId: args.causationId,
  },
  payload: args.payload,
});

export const encodeEnvelope = <T>(env: Envelope<T>): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(env));

export const decodeEnvelope = (bytes: Uint8Array): Envelope<unknown> => {
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (typeof raw !== "object" || raw === null || !("meta" in raw) || !("payload" in raw)) {
    throw new Error("malformed envelope: missing meta/payload");
  }
  const parsed = raw as { meta: unknown; payload: unknown };
  return { meta: envelopeMetaSchema.parse(parsed.meta), payload: parsed.payload };
};
