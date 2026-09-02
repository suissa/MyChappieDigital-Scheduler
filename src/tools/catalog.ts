/**
 * Tool catalog — every concrete Tool instance in the system, declared as code.
 *
 * This is where generic AtomicBehaviours become domain-specific tools: the
 * binding config is pulled entirely from `config/`, never written inline.
 */

import { instantiateTool } from "./factory.js";
import { classifyText } from "../behaviors/actions/classify-text/index.js";
import { scoreWeighted } from "../behaviors/actions/score-weighted/index.js";
import { selectTopK } from "../behaviors/actions/select-top-k/index.js";
import { assignSequencePosition } from "../behaviors/actions/assign-sequence-position/index.js";
import { reserveResource } from "../behaviors/actions/reserve-resource/index.js";
import { releaseResource } from "../behaviors/actions/release-resource/index.js";
import { requestHumanApproval } from "../behaviors/actions/request-human-approval/index.js";
import { recordProjection } from "../behaviors/actions/record-projection/index.js";
import { dispatchNotification } from "../behaviors/actions/dispatch-notification/index.js";
import { transcribeAudio } from "../behaviors/actions/transcribe-audio/index.js";

import { AGENT } from "../../config/identity.js";
import { SUBJECTS } from "../../config/subjects.js";
import {
  CONDITION_LEXICON,
  CRISIS_LEXICON,
  URGENCY_KEYWORDS,
  CONDITION,
} from "../../config/clinical.js";
import {
  MATCH_WEIGHTS,
  MATCH_PENALTIES,
  MATCH_VIABILITY_THRESHOLD,
  QUEUE,
  SLOT,
  SAGA,
} from "../../config/scheduling.js";
import { MODELS } from "../../config/ai-models.js";
import { PROJECTION } from "../../config/projections.js";
import { WHATSAPP } from "../../config/integrations.js";
import { UBIQUIC } from "../../config/broker.js";
import { PRICE_BOOK } from "../../config/money.js";

export const TOOL_CATALOG = {
  triageClassifier: instantiateTool({
    name: "triage.complaint-classifier",
    owner: AGENT.triage,
    behavior: classifyText,
    config: {
      lexicon: Object.fromEntries(
        Object.entries(CONDITION_LEXICON).map(([label, phrases]) => [label, [...phrases]]),
      ),
      fallbackLabel: CONDITION.desconhecido,
      escalation: { phrases: [...CRISIS_LEXICON], label: "crise" },
      severity: {
        priority: [...URGENCY_KEYWORDS.priority],
        elevated: [...URGENCY_KEYWORDS.elevated],
      },
    },
  }),

  affinityScorer: instantiateTool({
    name: "matching.affinity-scorer",
    owner: AGENT.matching,
    behavior: scoreWeighted,
    config: {
      weightsBps: {
        affinity: MATCH_WEIGHTS.affinityBps,
        availability: MATCH_WEIGHTS.availabilityBps,
        fairness: MATCH_WEIGHTS.fairnessBps,
        acceptanceRate: MATCH_WEIGHTS.acceptanceRateBps,
      },
      penaltyBps: {
        currentWorkload: MATCH_PENALTIES.currentWorkloadPerPatientBps,
        delayRisk: MATCH_PENALTIES.delayRiskBps,
      },
      totalBps: MATCH_WEIGHTS.totalBps,
    },
  }),

  candidateRanker: instantiateTool({
    name: "matching.top-candidate",
    owner: AGENT.matching,
    behavior: selectTopK,
    config: { k: 1, minScore: MATCH_VIABILITY_THRESHOLD },
  }),

  queuePositioner: instantiateTool({
    name: "queue.fair-positioner",
    owner: AGENT.queue,
    behavior: assignSequencePosition,
    config: {
      namespace: PROJECTION.queueStream,
      firstPosition: QUEUE.firstPosition,
      unitMinutes: QUEUE.etaMinutesPerPosition,
      maxTracked: QUEUE.maxTrackedPerProfessional,
    },
  }),

  slotReserver: instantiateTool({
    name: "scheduling.slot-reserver",
    owner: AGENT.scheduling,
    behavior: reserveResource,
    config: {
      poolNamespace: PROJECTION.slotPool,
      holdSeconds: SLOT.reservationHoldSeconds,
      maxAttempts: SAGA.slotReservationMaxAttempts,
      retryDelayMs: SAGA.slotReservationRetryDelayMs,
    },
  }),

  slotReleaser: instantiateTool({
    name: "scheduling.slot-releaser",
    owner: AGENT.scheduling,
    behavior: releaseResource,
    config: { poolNamespace: PROJECTION.slotPool },
  }),

  clinicalReviewGate: instantiateTool({
    name: "governance.clinical-review-gate",
    owner: AGENT.governance,
    behavior: requestHumanApproval,
    config: {
      requestSubject: SUBJECTS.clinicalReviewRequested,
      timeoutMs: UBIQUIC.requestTimeoutMs,
      defaultOnTimeout: "rejected",
    },
  }),

  queueProjectionWriter: instantiateTool({
    name: "queue.projection-writer",
    owner: AGENT.queue,
    behavior: recordProjection,
    config: { projection: PROJECTION.queue },
  }),

  consultaProjectionWriter: instantiateTool({
    name: "scheduling.projection-writer",
    owner: AGENT.scheduling,
    behavior: recordProjection,
    config: { projection: PROJECTION.consulta },
  }),

  affinityProjectionWriter: instantiateTool({
    name: "matching.affinity-projection-writer",
    owner: AGENT.matching,
    behavior: recordProjection,
    config: { projection: PROJECTION.affinity },
  }),

  whatsappDispatcher: instantiateTool({
    name: "notification.whatsapp-dispatcher",
    owner: AGENT.notification,
    behavior: dispatchNotification,
    config: {
      transport: "whatsapp",
      live: WHATSAPP.live,
      url: WHATSAPP.sendTextUrl,
      defaultDelayMs: WHATSAPP.defaultDelayMs,
    },
  }),

  audioTranscriber: instantiateTool({
    name: "intake.audio-transcriber",
    owner: AGENT.intake,
    behavior: transcribeAudio,
    config: {
      modelId: MODELS.audioTranscription.id,
      live: false,
      costCentavosPerMinute: PRICE_BOOK.audioTranscriptionPerMinute,
    },
  }),
} as const;

export type ToolCatalog = typeof TOOL_CATALOG;
export type ToolName = keyof ToolCatalog;
