/**
 * Composition root — wires config → adapters → tools → agents → runtime, on the
 * UbiQUIC broker. Compiling the flow graph is a hard startup gate: if the 2Flow
 * type contract is violated the system refuses to start (AGENTS.md §2.1, §33).
 */

import { createLogger, type Logger, type LogLevel } from "../kernel/logger.js";
import { systemClock, type Clock } from "../kernel/clock.js";
import { ID, asCausationId, asCorrelationId, type CorrelationId } from "../kernel/ids.js";
import { UbiQuicNatsClient } from "../messaging/ubiquic-nats-client.js";
import type { BrokerPort } from "../messaging/broker-port.js";
import { makeEnvelope } from "../messaging/envelope.js";
import { MemoryStore } from "../adapters/kv-memory.js";
import { AgentRuntime } from "../agents/runtime.js";
import { ALL_AGENTS } from "../agents/index.js";
import { MemoryDirectory, type ProfessionalDirectory } from "../domain/directory.js";
import { makeDemoDirectory } from "../fixtures/demo.js";
import { SCHEMA_VERSION, intakeSubmittedSchema } from "../domain/events.js";
import { SUBJECTS, KIND } from "../../config/subjects.js";
import { CONTEXT_LABEL } from "../../config/identity.js";
import { compileFlow } from "../orchestration/flow-dsl/index.js";
import {
  CONSULTA_SCHEDULING_DSL,
  CONSULTA_SCHEDULING_BINDINGS,
} from "../orchestration/flows/consulta-scheduling.flow.js";
import {
  TRANSCRIPT_CORRECTION_DSL,
  TRANSCRIPT_CORRECTION_BINDINGS,
} from "../orchestration/flows/transcript-correction.flow.js";
import type { AiPort, HttpPort } from "../behaviors/kind.js";

export type ReviewDeskMode = "auto-approve" | "auto-reject" | "external";

export interface BootstrapOptions {
  readonly clock?: Clock;
  readonly logLevel?: LogLevel;
  readonly directory?: ProfessionalDirectory;
  readonly reviewDesk?: ReviewDeskMode;
  readonly broker?: BrokerPort;
  readonly http?: HttpPort;
  readonly ai?: AiPort;
}

export interface IntakeSubmission {
  patient: { id: string; phone: string; displayName: string };
  complaintText: string;
  audioRef?: string;
  audioDurationSeconds?: number;
  offlineTranscript?: string;
  submittedAt?: string;
}

export interface SchedulerSystem {
  readonly runtime: AgentRuntime;
  readonly store: MemoryStore;
  readonly directory: ProfessionalDirectory;
  readonly broker: BrokerPort;
  readonly clock: Clock;
  readonly logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
  submitIntake(input: IntakeSubmission): Promise<{ intakeId: string; correlationId: CorrelationId }>;
  /** Publish an external command/fact into the bus (as `actor.external`). */
  emit(
    subject: string,
    payload: unknown,
    kind?: "event" | "command",
  ): Promise<{ correlationId: CorrelationId }>;
}

export const bootstrap = (opts: BootstrapOptions = {}): SchedulerSystem => {
  const clock = opts.clock ?? systemClock;
  const logger = createLogger(opts.logLevel ?? "info", { app: "mychappie-scheduler" });

  // Startup gate: every declared data-flow graph must type-check.
  compileFlow(TRANSCRIPT_CORRECTION_DSL, TRANSCRIPT_CORRECTION_BINDINGS);
  const graph = compileFlow(CONSULTA_SCHEDULING_DSL, CONSULTA_SCHEDULING_BINDINGS);
  logger.info("flow graph compiled", {
    flow: "consulta-scheduling",
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    entry: graph.entryType,
    exit: graph.exitType,
  });

  const store = new MemoryStore();
  const directory = opts.directory ?? makeDemoDirectory(clock);
  const broker = opts.broker ?? new UbiQuicNatsClient(logger);
  const runtime = new AgentRuntime({
    broker,
    store,
    clock,
    logger,
    directory,
    ...(opts.http ? { http: opts.http } : {}),
    ...(opts.ai ? { ai: opts.ai } : {}),
  }).register(...ALL_AGENTS);

  const reviewDesk = opts.reviewDesk ?? "external";

  const wrapIntake = (input: IntakeSubmission) => {
    const intakeId = ID.intake();
    const correlationId = ID.correlation();
    const payload = intakeSubmittedSchema.parse({
      intakeId,
      patient: input.patient,
      complaintText: input.complaintText,
      ...(input.audioRef ? { audioRef: input.audioRef } : {}),
      ...(input.audioDurationSeconds ? { audioDurationSeconds: input.audioDurationSeconds } : {}),
      ...(input.offlineTranscript ? { offlineTranscript: input.offlineTranscript } : {}),
      submittedAt: input.submittedAt ?? clock.nowIso(),
    });
    const env = makeEnvelope(
      {
        subject: SUBJECTS.intakeSubmitted,
        kind: KIND.event,
        schemaVersion: SCHEMA_VERSION,
        producer: "actor.patient",
        context: CONTEXT_LABEL.intake,
        correlationId: asCorrelationId(correlationId),
        causationId: asCausationId(correlationId),
        payload,
      },
      clock,
    );
    return { intakeId, correlationId: correlationId as CorrelationId, env };
  };

  return {
    runtime,
    store,
    directory,
    broker,
    clock,
    logger,
    async start() {
      await runtime.start();
      if (reviewDesk !== "external") {
        const decision = reviewDesk === "auto-approve" ? "approved" : "rejected";
        const attachDesk = (subject: string, queue: string, producer: string, context: string): void => {
          broker.subscribe(subject, { queue }, (msg) => {
            if (!msg.respond) return;
            msg.respond(
              makeEnvelope(
                {
                  subject: `${subject}.reply`,
                  kind: KIND.event,
                  schemaVersion: SCHEMA_VERSION,
                  producer,
                  context,
                  correlationId: asCorrelationId(msg.envelope.meta.correlationId),
                  causationId: asCausationId(msg.envelope.meta.id),
                  payload: { decision, reviewer: `desk:${reviewDesk}`, note: "automated desk" },
                },
                clock,
              ),
            );
          });
        };
        attachDesk(SUBJECTS.clinicalReviewRequested, "cg.review-desk", "actor.clinical-reviewer", CONTEXT_LABEL.governance);
        attachDesk(SUBJECTS.clarificationRequested, "cg.clarification-desk", "actor.transcription-reviewer", CONTEXT_LABEL.transcription);
        logger.info("hitl desks attached", { mode: reviewDesk });
      }
    },
    async stop() {
      await runtime.stop();
    },
    async submitIntake(input) {
      const { intakeId, correlationId, env } = wrapIntake(input);
      await broker.publish(SUBJECTS.intakeSubmitted, env);
      logger.info("intake submitted", { intakeId, correlationId });
      return { intakeId, correlationId };
    },
    async emit(subject, payload, kind = "command") {
      const correlationId = ID.correlation();
      const env = makeEnvelope(
        {
          subject,
          kind: kind === "command" ? KIND.command : KIND.event,
          schemaVersion: SCHEMA_VERSION,
          producer: "actor.external",
          context: CONTEXT_LABEL.orchestration,
          correlationId: asCorrelationId(correlationId),
          causationId: asCausationId(correlationId),
          payload,
        },
        clock,
      );
      await broker.publish(subject, env);
      return { correlationId: correlationId as CorrelationId };
    },
  };
};

export { MemoryDirectory };
