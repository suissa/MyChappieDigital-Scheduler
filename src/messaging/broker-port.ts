/**
 * The seam between the agents and UbiQUIC.
 *
 * There is exactly one implementation — `UbiQuicNatsClient` — and it is a thin
 * wrapper over the off-the-shelf `nats` client pointed at the Zig sidecar. No
 * brokering logic (fan-out, DLQ, event sourcing, acks) lives on this side; that
 * is the sidecar's job.
 */

import type { Envelope } from "./envelope.js";

export interface DeliveredMessage {
  readonly subject: string;
  readonly envelope: Envelope<unknown>;
  /** Present when the publisher expects a response (request/reply). */
  respond?: (env: Envelope<unknown>) => void;
}

export type MessageHandler = (msg: DeliveredMessage) => void | Promise<void>;

export interface SubscribeOptions {
  /** NATS queue group — members share the load for a subject. */
  readonly queue?: string;
  readonly maxInFlight?: number;
}

export interface Subscription {
  readonly subject: string;
  unsubscribe(): void;
}

export interface BrokerPort {
  readonly connected: boolean;
  connect(): Promise<void>;
  publish<T>(subject: string, envelope: Envelope<T>): Promise<void>;
  subscribe(subject: string, options: SubscribeOptions, handler: MessageHandler): Subscription;
  request<TReq, TRes>(
    subject: string,
    envelope: Envelope<TReq>,
    timeoutMs?: number,
  ): Promise<Envelope<TRes>>;
  drain(): Promise<void>;
}
