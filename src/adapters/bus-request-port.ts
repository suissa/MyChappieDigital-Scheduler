/**
 * `RequestPort` for behaviours — request/reply and fire-and-forget publish over
 * UbiQUIC. Wraps the raw payload in an envelope so the broker sees a
 * well-formed, correlated message; unwraps the response payload for the caller.
 */

import type { RequestPort } from "../behaviors/kind.js";
import type { BrokerPort } from "../messaging/broker-port.js";
import { makeEnvelope } from "../messaging/envelope.js";
import type { Clock } from "../kernel/clock.js";
import { asCausationId, asCorrelationId } from "../kernel/ids.js";
import { SCHEMA_VERSION } from "../domain/events.js";
import { KIND } from "../../config/subjects.js";

export const makeBusRequestPort = (args: {
  broker: BrokerPort;
  clock: Clock;
  producer: string;
  context: string;
  correlationId: string;
}): RequestPort => {
  const env = <T>(subject: string, kind: "event" | "command", payload: T) =>
    makeEnvelope(
      {
        subject,
        kind,
        schemaVersion: SCHEMA_VERSION,
        producer: args.producer,
        context: args.context,
        correlationId: asCorrelationId(args.correlationId),
        causationId: asCausationId(args.correlationId),
        payload,
      },
      args.clock,
    );

  return {
    async ask<TRes>(subject: string, payload: unknown, timeoutMs?: number): Promise<TRes> {
      const reply = await args.broker.request<unknown, TRes>(
        subject,
        env(subject, KIND.command, payload),
        timeoutMs,
      );
      return reply.payload;
    },
    async emit(subject: string, payload: unknown): Promise<void> {
      await args.broker.publish(subject, env(subject, KIND.event, payload));
    },
  };
};
