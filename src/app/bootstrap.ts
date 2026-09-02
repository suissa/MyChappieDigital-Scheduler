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

export type ReviewDeskMode = "auto-approve" | "auto-reject" | "external";

export interface BootstrapOptions {
  readonly clock?: Clock;
  readonly logLevel?: LogLevel;
  readonly directory?: ProfessionalDirectory;
  readonly reviewDesk?: ReviewDeskMode;
  readonly broker?: BrokerPort;
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
}

export const bootstrap = (opts: BootstrapOptions = {}): SchedulerSystem => {
  const clock = opts.clock ?? systemClock;
  const logger = createLogger(opts.logLevel ?? "info", { app: "mychappie-scheduler" });

  // Startup gate: the declared data-flow graph must type-check.
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
  const runtime = new AgentRuntime({ broker, store, clock, logger, directory }).register(...ALL_AGENTS);

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
        broker.subscribe(SUBJECTS.clinicalReviewRequested, { queue: "cg.review-desk" }, (msg) => {
          if (!msg.respond) return;
          const decision = reviewDesk === "auto-approve" ? "approved" : "rejected";
          const reply = makeEnvelope(
            {
              subject: `${SUBJECTS.clinicalReviewRequested}.reply`,
              kind: KIND.event,
              schemaVersion: SCHEMA_VERSION,
              producer: "actor.clinical-reviewer",
              context: CONTEXT_LABEL.governance,
              correlationId: asCorrelationId(msg.envelope.meta.correlationId),
              causationId: asCausationId(msg.envelope.meta.id),
              payload: { decision, reviewer: `desk:${reviewDesk}`, note: "automated review desk" },
            },
            clock,
          );
          msg.respond(reply);
        });
        logger.info("review desk attached", { mode: reviewDesk });
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
  };
};

export { MemoryDirectory };
