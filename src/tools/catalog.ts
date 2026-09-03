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
import { assemblePrompt } from "../behaviors/actions/assemble-prompt/index.js";
import { llmComplete } from "../behaviors/actions/llm-complete/index.js";
import { guardResponse } from "../behaviors/actions/guard-response/index.js";
import { translateText } from "../behaviors/actions/translate-text/index.js";
import { synthesizeSpeech } from "../behaviors/actions/synthesize-speech/index.js";
import { mirrorCalendarEvent } from "../behaviors/actions/mirror-calendar-event/index.js";
import { pollExternalCalendar } from "../behaviors/actions/poll-external-calendar/index.js";

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
import { ASR_PROVIDER, PROMPT_SECTION, CORRECTION, SCOPE_GUARD } from "../../config/transcription.js";
import { ELEVENLABS, VOICE_MODE, DEFAULT_LIBRARY_VOICE_ID, SPEECH_TRANSLATION } from "../../config/speech.js";
import { GOOGLE_CALENDAR } from "../../config/calendar.js";

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

  /** Primary (free) transcription: local Whisper. */
  whisperLocalTranscriber: instantiateTool({
    name: "intake.whisper-local-transcriber",
    owner: AGENT.intake,
    behavior: transcribeAudio,
    config: { providerKey: ASR_PROVIDER.whisperLocal.key, modelId: ASR_PROVIDER.whisperLocal.modelId },
  }),

  /** Paid transcription module: Groq. */
  groqTranscriber: instantiateTool({
    name: "transcription.groq-transcriber",
    owner: AGENT.transcription,
    behavior: transcribeAudio,
    config: { providerKey: ASR_PROVIDER.groq.key, modelId: ASR_PROVIDER.groq.modelId },
  }),

  // --- transcription correction pipeline -------------------------------
  correctionPromptAssembler: instantiateTool({
    name: "transcription.prompt-assembler",
    owner: AGENT.transcription,
    behavior: assemblePrompt,
    config: {
      sections: PROMPT_SECTION.map((s) => ({
        id: s.id,
        heading: s.heading,
        ...("body" in s ? { body: s.body } : {}),
        ...("dynamic" in s ? { dynamic: s.dynamic } : {}),
        ...("optional" in s ? { optional: s.optional } : {}),
      })),
      divider: "\n\n---\n\n",
      charsPerToken: 4,
    },
  }),

  transcriptCorrector: instantiateTool({
    name: "transcription.llm-corrector",
    owner: AGENT.transcription,
    behavior: llmComplete,
    config: {
      modelId: CORRECTION.modelId,
      temperature: CORRECTION.temperature,
      live: CORRECTION.live,
      expectJson: true,
    },
  }),

  clarificationGate: instantiateTool({
    name: "transcription.clarification-gate",
    owner: AGENT.transcription,
    behavior: requestHumanApproval,
    config: {
      requestSubject: SUBJECTS.clarificationRequested,
      timeoutMs: UBIQUIC.requestTimeoutMs,
      defaultOnTimeout: "rejected",
    },
  }),

  transcriptScopeGuard: instantiateTool({
    name: "transcription.scope-guard",
    owner: AGENT.transcription,
    behavior: guardResponse,
    config: {
      triggers: {
        hasUnknowns: SCOPE_GUARD.triggers.hasUnknowns,
        hasNeedsExplanation: SCOPE_GUARD.triggers.hasNeedsExplanation,
        editRatioAbove: SCOPE_GUARD.triggers.editRatioAbove,
        addedSentencesNotInRaw: SCOPE_GUARD.triggers.addedSentencesNotInRaw,
        confidenceBelow: SCOPE_GUARD.triggers.confidenceBelow,
      },
    },
  }),

  transcriptProjectionWriter: instantiateTool({
    name: "transcription.projection-writer",
    owner: AGENT.transcription,
    behavior: recordProjection,
    config: { projection: PROJECTION.transcript },
  }),

  clarificationProjectionWriter: instantiateTool({
    name: "transcription.clarification-writer",
    owner: AGENT.transcription,
    behavior: recordProjection,
    config: { projection: PROJECTION.clarification },
  }),

  // --- speech synthesis (elevenlabs) ---------------------------------
  replyTranslator: instantiateTool({
    name: "voice.reply-translator",
    owner: AGENT.voice,
    behavior: translateText,
    config: { modelId: SPEECH_TRANSLATION.translatorModelId, live: SPEECH_TRANSLATION.live },
  }),

  voiceSynthesizer: instantiateTool({
    name: "voice.speech-synthesizer",
    owner: AGENT.voice,
    behavior: synthesizeSpeech,
    config: {
      modelId: ELEVENLABS.modelId,
      live: ELEVENLABS.live,
      voiceMode: VOICE_MODE.cloned,
      defaultVoiceId: DEFAULT_LIBRARY_VOICE_ID,
      creditsPerCharacter: ELEVENLABS.creditsPerCharacter,
      monthlyCreditBudget: ELEVENLABS.monthlyCreditBudget,
    },
  }),

  speechProjectionWriter: instantiateTool({
    name: "voice.projection-writer",
    owner: AGENT.voice,
    behavior: recordProjection,
    config: { projection: PROJECTION.speech },
  }),

  // --- google calendar mirror (data only) --------------------------
  calendarMirror: instantiateTool({
    name: "calendar.google-mirror",
    owner: AGENT.calendarMirror,
    behavior: mirrorCalendarEvent,
    config: {
      provider: "google",
      live: GOOGLE_CALENDAR.live,
      baseUrl: GOOGLE_CALENDAR.baseUrl,
      calendarId: GOOGLE_CALENDAR.calendarId,
      tokenEnvVar: GOOGLE_CALENDAR.tokenEnvVar,
      timezone: GOOGLE_CALENDAR.timezone,
      systemTag: GOOGLE_CALENDAR.systemTag,
      correlationPropertyKey: GOOGLE_CALENDAR.correlationPropertyKey,
      stateNamespace: PROJECTION.calendarMirror,
    },
  }),

  calendarPoller: instantiateTool({
    name: "calendar.google-poller",
    owner: AGENT.calendarMirror,
    behavior: pollExternalCalendar,
    config: {
      provider: "google",
      live: GOOGLE_CALENDAR.live,
      baseUrl: GOOGLE_CALENDAR.baseUrl,
      calendarId: GOOGLE_CALENDAR.calendarId,
      systemTag: GOOGLE_CALENDAR.systemTag,
      stateNamespace: PROJECTION.externalCalendar,
    },
  }),
} as const;

export type ToolCatalog = typeof TOOL_CATALOG;
export type ToolName = keyof ToolCatalog;
