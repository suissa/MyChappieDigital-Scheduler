/**
 * UbiQUIC (QUICMQ) connection parameters as code.
 *
 * This is the single source of truth for how the TypeScript agents reach the
 * Zig message broker. It intentionally mirrors
 * packages/Services/UbiQUIC/config.yml — the sidecar owns brokering; TypeScript
 * only ever connects as a NATS client.
 */

export const UBIQUIC = Object.freeze({
  host: "127.0.0.1",
  port: 4433,
  /** `nats` client server URL. */
  get serverUrl(): string {
    return `nats://${this.host}:${this.port}`;
  },
  name: "mychappie-scheduler",
  /** Reconnect behaviour for the nats client. */
  reconnect: true,
  maxReconnectAttempts: -1,
  reconnectTimeWaitMs: 500,
  pingIntervalMs: 20_000,
  /** How long a behaviour request waits for its response before failing. */
  requestTimeoutMs: 5_000,
  /** Startup wait for the sidecar to accept connections. */
  connectTimeoutMs: 4_000,
} as const);

/** Consumer/queue-group names, as code. */
export const CONSUMER_GROUP = Object.freeze({
  intake: "cg.intake",
  triage: "cg.triage",
  matching: "cg.matching",
  scheduling: "cg.scheduling",
  queue: "cg.queue",
  notification: "cg.notification",
  governance: "cg.governance",
  audit: "cg.audit",
} as const);
export type ConsumerGroup = (typeof CONSUMER_GROUP)[keyof typeof CONSUMER_GROUP];
