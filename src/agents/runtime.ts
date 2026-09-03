/**
 * AgentRuntime — the choreography engine.
 *
 * It connects the agents to UbiQUIC: every `AgentSubscription` becomes a broker
 * subscription (queue-grouped so a scaled-out agent shares load). On delivery it
 * validates the payload against the subject's schema, builds a scoped
 * `AgentHandlerCtx` and runs the handler. Handlers react and emit the next
 * fact — no central conductor. The Orchestrator is just another agent that
 * happens to supervise the gate and the failure paths.
 */

import type { BrokerPort, Subscription } from "../messaging/broker-port.js";
import { makeEnvelope, type Envelope } from "../messaging/envelope.js";
import type { Clock } from "../kernel/clock.js";
import type { Logger } from "../kernel/logger.js";
import { asCausationId, asCorrelationId } from "../kernel/ids.js";
import { err, type Result } from "../kernel/result.js";
import { schemaForSubject, SCHEMA_VERSION, type KnownSubject, type PayloadOf } from "../domain/events.js";
import { KIND, isKnownSubject } from "../../config/subjects.js";
import type { MemoryStore } from "../adapters/kv-memory.js";
import type { ProfessionalDirectory } from "../domain/directory.js";
import { fetchHttpPort } from "../adapters/http-fetch.js";
import { offlineAiGateway } from "../adapters/ai-gateway.js";
import { makeBusRequestPort } from "../adapters/bus-request-port.js";
import { TOOL_CATALOG, type ToolName } from "../tools/catalog.js";
import type { AiPort, BehaviorContext, HttpPort } from "../behaviors/kind.js";
import type { Agent, AgentHandlerCtx, AgentSubscription } from "./agent.js";

export interface RuntimeDeps {
  readonly broker: BrokerPort;
  readonly store: MemoryStore;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly directory: ProfessionalDirectory;
  readonly http?: HttpPort;
  readonly ai?: AiPort;
}

export class AgentRuntime {
  readonly #deps: RuntimeDeps;
  readonly #agents: Agent[] = [];
  readonly #subs: Subscription[] = [];
  /** One serial mailbox per agent — an Actor processes one message at a time. */
  readonly #mailbox = new Map<string, Promise<unknown>>();
  #emitCount = 0;
  #inFlight = 0;

  constructor(deps: RuntimeDeps) {
    this.#deps = deps;
  }

  get emitCount(): number {
    return this.#emitCount;
  }

  /** True while any agent mailbox still has work queued. */
  get idle(): boolean {
    return this.#inFlight === 0;
  }

  register(...agents: Agent[]): this {
    this.#agents.push(...agents);
    return this;
  }

  #enqueue(mailboxKey: string, task: () => Promise<void>): void {
    this.#inFlight += 1;
    const prev = this.#mailbox.get(mailboxKey) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(task)
      .catch(() => undefined)
      .finally(() => {
        this.#inFlight -= 1;
      });
    this.#mailbox.set(mailboxKey, next);
  }

  async start(): Promise<void> {
    await this.#deps.broker.connect();
    for (const agent of this.#agents) {
      for (const sub of agent.subscriptions) {
        this.#subs.push(
          this.#deps.broker.subscribe(sub.subject, { queue: sub.queueGroup }, (msg) => {
            this.#enqueue(agent.label, () =>
              this.#dispatch(agent, sub, msg.subject, msg.envelope, msg.respond),
            );
          }),
        );
        this.#deps.logger.info("agent subscribed", {
          agent: agent.label,
          subject: sub.subject,
          queue: sub.queueGroup,
        });
      }
    }
  }

  async stop(): Promise<void> {
    for (const s of this.#subs) s.unsubscribe();
    this.#subs.length = 0;
    await this.#deps.broker.drain();
  }

  async #dispatch(
    agent: Agent,
    sub: AgentSubscription,
    subject: string,
    envelope: Envelope<unknown>,
    respond?: (env: Envelope<unknown>) => void,
  ): Promise<void> {
    const log = this.#deps.logger.child({
      agent: agent.label,
      subject,
      correlationId: envelope.meta.correlationId,
    });

    const schema = schemaForSubject(subject);
    let payload: unknown = envelope.payload;
    if (schema) {
      const parsed = schema.safeParse(envelope.payload);
      if (!parsed.success) {
        log.error("payload failed schema — dropped", { issues: parsed.error.issues });
        return;
      }
      payload = parsed.data;
    }

    const ctx = this.#handlerCtx(agent, envelope, respond && sub.requestReply ? respond : undefined);

    try {
      await sub.handle(payload, ctx);
    } catch (e) {
      log.error("handler failed", { error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }

  #handlerCtx(
    agent: Agent,
    incoming: Envelope<unknown>,
    respond?: (env: Envelope<unknown>) => void,
  ): AgentHandlerCtx {
    const { broker, store, clock, logger, directory } = this.#deps;
    const correlationId = incoming.meta.correlationId;
    const causationId = incoming.meta.id;
    const runtime = this;

    const emit = async <S extends KnownSubject>(subject: S, body: PayloadOf<S>): Promise<void> => {
      const schema = schemaForSubject(subject);
      if (schema) {
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          logger.error("refused to emit invalid payload", {
            agent: agent.label,
            subject,
            issues: parsed.error.issues,
          });
          return;
        }
      }
      const kind = subject.endsWith(`command.${"v1"}`) ? KIND.command : KIND.event;
      const env = makeEnvelope(
        {
          subject,
          kind,
          schemaVersion: SCHEMA_VERSION,
          producer: agent.label,
          context: agent.context,
          correlationId: asCorrelationId(correlationId),
          causationId: asCausationId(causationId),
          payload: body,
        },
        clock,
      );
      await broker.publish(subject, env);
      runtime.#emitCount += 1;
    };

    const behaviorCtx = (): BehaviorContext => ({
      clock,
      logger: logger.child({ agent: agent.label }),
      kv: store,
      locks: store,
      bus: makeBusRequestPort({
        broker,
        clock,
        producer: agent.label,
        context: agent.context,
        correlationId,
      }),
      http: this.#deps.http ?? fetchHttpPort,
      ai: this.#deps.ai ?? offlineAiGateway,
      correlationId,
    });

    const invokeTool = async <TInput, TOutput>(
      name: ToolName,
      input: TInput,
    ): Promise<Result<TOutput>> => {
      const tool = TOOL_CATALOG[name] as unknown as {
        invoke(ctx: BehaviorContext, input: unknown, invoker: string): Promise<Result<unknown>>;
      };
      if (!tool) return err({ code: "UNKNOWN_TOOL", message: name });
      return tool.invoke(behaviorCtx(), input, agent.label) as Promise<Result<TOutput>>;
    };

    const ctx: AgentHandlerCtx = {
      correlationId,
      causationId,
      incomingSubject: incoming.meta.subject,
      incomingProducer: incoming.meta.producer,
      logger: logger.child({ agent: agent.label, correlationId }),
      clock,
      kv: store,
      directory,
      emit,
      invokeTool,
    };

    if (respond) {
      return {
        ...ctx,
        reply: (body: unknown) => {
          const env = makeEnvelope(
            {
              subject: `${incoming.meta.subject}.reply`,
              kind: KIND.event,
              schemaVersion: SCHEMA_VERSION,
              producer: agent.label,
              context: agent.context,
              correlationId: asCorrelationId(correlationId),
              causationId: asCausationId(causationId),
              payload: body,
            },
            clock,
          );
          respond(env);
        },
      };
    }
    return ctx;
  }
}

export const isConcreteSubject = (s: string): boolean => isKnownSubject(s);
