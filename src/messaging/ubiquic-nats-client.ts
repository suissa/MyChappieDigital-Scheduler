/**
 * UbiQUIC client — the *only* broker implementation.
 *
 * Uses the unmodified `nats` npm client. It connects to the Zig QUICMQ sidecar
 * (which speaks the NATS wire protocol). Publishing here becomes an event-
 * sourced record + fan-out inside the sidecar; nothing is re-implemented.
 */

import {
  connect,
  type NatsConnection,
  type Subscription as NatsSub,
  type Msg,
} from "nats";
import { UBIQUIC } from "../../config/broker.js";
import type { Logger } from "../kernel/logger.js";
import {
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
} from "./envelope.js";
import type {
  BrokerPort,
  MessageHandler,
  SubscribeOptions,
  Subscription,
} from "./broker-port.js";

export class UbiQuicNatsClient implements BrokerPort {
  #nc: NatsConnection | null = null;
  readonly #log: Logger;

  constructor(log: Logger) {
    this.#log = log.child({ component: "ubiquic-nats-client", url: UBIQUIC.serverUrl });
  }

  get connected(): boolean {
    return this.#nc !== null && !this.#nc.isClosed();
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.#nc = await connect({
      servers: UBIQUIC.serverUrl,
      name: UBIQUIC.name,
      reconnect: UBIQUIC.reconnect,
      maxReconnectAttempts: UBIQUIC.maxReconnectAttempts,
      reconnectTimeWait: UBIQUIC.reconnectTimeWaitMs,
      pingInterval: UBIQUIC.pingIntervalMs,
      timeout: UBIQUIC.connectTimeoutMs,
      waitOnFirstConnect: false,
    });
    this.#log.info("connected to UbiQUIC sidecar");
  }

  #conn(): NatsConnection {
    if (!this.#nc || this.#nc.isClosed()) throw new Error("UbiQUIC not connected");
    return this.#nc;
  }

  async publish<T>(subject: string, envelope: Envelope<T>): Promise<void> {
    this.#conn().publish(subject, encodeEnvelope(envelope));
  }

  subscribe(subject: string, options: SubscribeOptions, handler: MessageHandler): Subscription {
    const sub: NatsSub = this.#conn().subscribe(subject, {
      ...(options.queue ? { queue: options.queue } : {}),
      ...(options.maxInFlight ? { max: options.maxInFlight } : {}),
      callback: (error: Error | null, msg: Msg): void => {
        if (error) {
          this.#log.error("subscription error", { subject, error: error.message });
          return;
        }
        void this.#dispatch(subject, msg, handler);
      },
    });
    return { subject, unsubscribe: () => sub.unsubscribe() };
  }

  async #dispatch(subject: string, msg: Msg, handler: MessageHandler): Promise<void> {
    let envelope: Envelope<unknown>;
    try {
      envelope = decodeEnvelope(msg.data);
    } catch (e) {
      this.#log.error("undecodable envelope dropped", {
        subject,
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    try {
      await handler({
        subject: msg.subject,
        envelope,
        ...(msg.reply
          ? { respond: (env: Envelope<unknown>) => msg.respond(encodeEnvelope(env)) }
          : {}),
      });
    } catch (e) {
      this.#log.error("handler threw", {
        subject,
        correlationId: envelope.meta.correlationId,
        error: e instanceof Error ? e.stack ?? e.message : String(e),
      });
    }
  }

  async request<TReq, TRes>(
    subject: string,
    envelope: Envelope<TReq>,
    timeoutMs: number = UBIQUIC.requestTimeoutMs,
  ): Promise<Envelope<TRes>> {
    const reply = await this.#conn().request(subject, encodeEnvelope(envelope), {
      timeout: timeoutMs,
    });
    return decodeEnvelope(reply.data) as Envelope<TRes>;
  }

  async drain(): Promise<void> {
    const nc = this.#nc;
    this.#nc = null;
    if (!nc || nc.isClosed()) return;
    const bounded = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
      Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
    try {
      await bounded(nc.drain(), 2_000);
    } finally {
      if (!nc.isClosed()) await bounded(nc.close(), 2_000);
    }
  }
}
