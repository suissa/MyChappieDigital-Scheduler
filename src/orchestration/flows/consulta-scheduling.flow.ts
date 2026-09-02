/**
 * THE flow: from a patient's intake to a confirmed consulta.
 *
 * Declared once, as a graph, in the Lucy-mae 2Flow notation. The runtime is
 * choreographed — each node is owned by an agent that reacts to the node's
 * `listens` subject and emits its `emits` fact — except the `[?ClinicalReview]`
 * gate and the `!->` saga edge, which the Orchestrator supervises.
 *
 * Two type levels are in play (both enforced):
 *   - flow contract  : the phase types below, checked by `typecheckGraph`
 *   - tool contract  : each Tool's own zod i/o schema, checked at `invoke`
 * The agent handler bridges them (fetch data, build tool input, fold the
 * result into the next phase aggregate).
 */

import { SEMANTIC_TYPE } from "../../../config/semantic-types.js";
import { SUBJECTS } from "../../../config/subjects.js";
import { AGENT } from "../../../config/identity.js";
import type { FlowBindings } from "../flow-dsl/index.js";

export const CONSULTA_SCHEDULING_DSL =
  "ReceiveIntake" +
  " :--: TriageComplaint" +
  " :--: [?ClinicalReview]" +
  " :--: [ ScoreAffinity :--: RankProfessional , ScreenClinicPolicy ]" +
  " :--: AssignQueueSlot" +
  " :--: ReserveConsultaSlot !-> ReleaseSlotHold" +
  " :--: RecordConsulta" +
  " :--: NotifyPatient";

/** Which agent owns (reacts to) each node — the choreography wiring. */
export const NODE_OWNER = Object.freeze({
  ReceiveIntake: AGENT.intake,
  TriageComplaint: AGENT.triage,
  ClinicalReview: AGENT.governance,
  ScoreAffinity: AGENT.matching,
  RankProfessional: AGENT.matching,
  ScreenClinicPolicy: AGENT.matching,
  AssignQueueSlot: AGENT.queue,
  ReserveConsultaSlot: AGENT.scheduling,
  ReleaseSlotHold: AGENT.scheduling,
  RecordConsulta: AGENT.scheduling,
  NotifyPatient: AGENT.notification,
} as const);

export const CONSULTA_SCHEDULING_BINDINGS: FlowBindings = Object.freeze({
  ReceiveIntake: {
    role: "action",
    tool: "audioTranscriber",
    inputType: SEMANTIC_TYPE.intakeSubmission,
    outputType: SEMANTIC_TYPE.intakeSubmission,
    listens: SUBJECTS.intakeSubmitted,
    emits: SUBJECTS.triageRequested,
  },
  TriageComplaint: {
    role: "action",
    tool: "triageClassifier",
    inputType: SEMANTIC_TYPE.intakeSubmission,
    outputType: SEMANTIC_TYPE.triagedIntake,
    listens: SUBJECTS.triageRequested,
    emits: SUBJECTS.triageCompleted,
  },
  ClinicalReview: {
    role: "gate",
    tool: "clinicalReviewGate",
    inputType: SEMANTIC_TYPE.triagedIntake,
    outputType: SEMANTIC_TYPE.triagedIntake,
    listens: SUBJECTS.crisisDetected,
    emits: SUBJECTS.clinicalReviewResolved,
    gateSubject: SUBJECTS.clinicalReviewRequested,
  },
  ScoreAffinity: {
    role: "action",
    tool: "affinityScorer",
    inputType: SEMANTIC_TYPE.triagedIntake,
    outputType: SEMANTIC_TYPE.scoredCandidateSet,
    listens: SUBJECTS.matchingRequested,
  },
  RankProfessional: {
    role: "action",
    tool: "candidateRanker",
    inputType: SEMANTIC_TYPE.scoredCandidateSet,
    outputType: SEMANTIC_TYPE.matchedIntake,
    emits: SUBJECTS.professionalMatched,
  },
  ScreenClinicPolicy: {
    role: "action",
    inputType: SEMANTIC_TYPE.triagedIntake,
    outputType: SEMANTIC_TYPE.matchedIntake,
    listens: SUBJECTS.matchingRequested,
  },
  AssignQueueSlot: {
    role: "action",
    tool: "queuePositioner",
    inputType: SEMANTIC_TYPE.matchedIntake,
    outputType: SEMANTIC_TYPE.queuedIntake,
    listens: SUBJECTS.professionalMatched,
    emits: SUBJECTS.queuePositionAssigned,
  },
  ReserveConsultaSlot: {
    role: "action",
    tool: "slotReserver",
    inputType: SEMANTIC_TYPE.queuedIntake,
    outputType: SEMANTIC_TYPE.scheduledConsulta,
    listens: SUBJECTS.queuePositionAssigned,
    emits: SUBJECTS.consultaScheduled,
  },
  ReleaseSlotHold: {
    role: "compensator",
    tool: "slotReleaser",
    inputType: SEMANTIC_TYPE.queuedIntake,
    outputType: SEMANTIC_TYPE.queuedIntake,
    listens: SUBJECTS.slotReservationFailed,
    emits: SUBJECTS.slotHoldReleased,
  },
  RecordConsulta: {
    role: "action",
    tool: "consultaProjectionWriter",
    inputType: SEMANTIC_TYPE.scheduledConsulta,
    outputType: SEMANTIC_TYPE.persistedConsulta,
    listens: SUBJECTS.consultaScheduled,
    emits: SUBJECTS.consultaProjectionUpdated,
  },
  NotifyPatient: {
    role: "action",
    tool: "whatsappDispatcher",
    inputType: SEMANTIC_TYPE.persistedConsulta,
    outputType: SEMANTIC_TYPE.confirmedConsulta,
    listens: SUBJECTS.consultaProjectionUpdated,
    emits: SUBJECTS.whatsappDispatched,
  },
});
