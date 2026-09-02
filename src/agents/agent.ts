/**
 * Agent — an Actor specialised for autonomous reaction, decision and invocation
 * (AGENTS.md §3, §4).
 *
 * An agent is declarative: it states its identity, its context, the Tools it
 * may drive and the subjects it reacts to. It never touches the broker or a
 * store directly — the runtime hands each handler a scoped `AgentHandlerCtx`.
 */

import type { Logger } from "../kernel/logger.js";
import type { Clock } from "../kernel/clock.js";
import type { KvPort } from "../behaviors/kind.js";
import type { Result } from "../kernel/result.js";
import type { ToolName } from "../tools/catalog.js";
import type { KnownSubject, PayloadOf } from "../domain/events.js";
import type { ProfessionalDirectory } from "../domain/directory.js";

export interface AgentHandlerCtx {
  /** Flow correlation id, threaded from the triggering envelope. */
  readonly correlationId: string;
  /** The id of the event that caused this handler to run. */
  readonly causationId: string;
  /** The concrete subject the message arrived on. */
  readonly incomingSubject: string;
  /** The actor that produced the triggering message. */
  readonly incomingProducer: string;
  readonly logger: Logger;
  readonly clock: Clock;
  /** Read side: projections & seeded read models. */
  readonly kv: KvPort;
  readonly directory: ProfessionalDirectory;

  /** Emit a typed domain fact / command. */
  emit<S extends KnownSubject>(subject: S, payload: PayloadOf<S>): Promise<void>;

  /** Drive one of this agent's Tools. The Tool authorises the call itself. */
  invokeTool<TInput, TOutput>(name: ToolName, input: TInput): Promise<Result<TOutput>>;

  /** Present only for request/reply subscriptions — send the reply payload. */
  readonly reply?: (payload: unknown) => void;
}

export interface AgentSubscription {
  readonly subject: string;
  readonly queueGroup: string;
  /** True when this subscription answers a request (gets `ctx.reply`). */
  readonly requestReply?: boolean;
  handle(payload: unknown, ctx: AgentHandlerCtx): Promise<void>;
}

export interface Agent {
  readonly label: string;
  readonly context: string;
  /** Tool instances this agent is allowed to drive. */
  readonly tools: readonly ToolName[];
  readonly subscriptions: readonly AgentSubscription[];
}

export const defineAgent = (a: Agent): Agent => a;
