/**
 * Transcription correction flow — local Whisper draft, then an LLM correction
 * pass built from a richly assembled prompt, then a scope guard. Anything the
 * model produces that is outside the request or the known vocabulary engages
 * the `[?ResolveClarification]` gate (freeze → ask for an explanation → resume).
 *
 * Declared as a graph in the 2Flow notation, like every other flow.
 */

import { SEMANTIC_TYPE } from "../../../config/semantic-types.js";
import { SUBJECTS } from "../../../config/subjects.js";
import { AGENT } from "../../../config/identity.js";
import type { FlowBindings } from "../flow-dsl/index.js";

export const TRANSCRIPT_CORRECTION_DSL =
  "TranscribeAudio" +
  " :--: AssembleCorrectionPrompt" +
  " :--: CorrectWithLlm" +
  " :--: GuardCorrection" +
  " :--: [?ResolveClarification]" +
  " :--: FinalizeTranscript";

export const TRANSCRIPT_NODE_OWNER = Object.freeze({
  TranscribeAudio: AGENT.transcription,
  AssembleCorrectionPrompt: AGENT.transcription,
  CorrectWithLlm: AGENT.transcription,
  GuardCorrection: AGENT.transcription,
  ResolveClarification: AGENT.transcription,
  FinalizeTranscript: AGENT.transcription,
} as const);

export const TRANSCRIPT_CORRECTION_BINDINGS: FlowBindings = Object.freeze({
  TranscribeAudio: {
    role: "action",
    tool: "whisperLocalTranscriber",
    inputType: SEMANTIC_TYPE.attachedAudio,
    outputType: SEMANTIC_TYPE.rawTranscript,
    listens: SUBJECTS.transcriptionRequested,
    emits: SUBJECTS.transcriptDrafted,
  },
  AssembleCorrectionPrompt: {
    role: "action",
    tool: "correctionPromptAssembler",
    inputType: SEMANTIC_TYPE.rawTranscript,
    outputType: SEMANTIC_TYPE.assembledPrompt,
  },
  CorrectWithLlm: {
    role: "action",
    tool: "transcriptCorrector",
    inputType: SEMANTIC_TYPE.assembledPrompt,
    outputType: SEMANTIC_TYPE.llmCompletion,
  },
  GuardCorrection: {
    role: "action",
    tool: "transcriptScopeGuard",
    inputType: SEMANTIC_TYPE.llmCompletion,
    outputType: SEMANTIC_TYPE.guardedResponse,
  },
  ResolveClarification: {
    role: "gate",
    tool: "clarificationProjectionWriter",
    inputType: SEMANTIC_TYPE.guardedResponse,
    outputType: SEMANTIC_TYPE.guardedResponse,
    listens: SUBJECTS.clarificationRequested,
    emits: SUBJECTS.clarificationResolved,
    gateSubject: SUBJECTS.clarificationRequested,
  },
  FinalizeTranscript: {
    role: "action",
    tool: "transcriptProjectionWriter",
    inputType: SEMANTIC_TYPE.guardedResponse,
    outputType: SEMANTIC_TYPE.finalTranscript,
    emits: SUBJECTS.transcriptFinalized,
  },
});
