/**
 * Transcription pipeline as code.
 *
 * Primary (free) path: **local Whisper → LLM correction pass**. The correction
 * prompt is assembled from many context contributors so the LLM has everything
 * it needs to decide. Any part of the LLM's answer that is outside the request
 * or outside the known vocabulary must trigger a request for explanation.
 *
 * Paid path: the Groq module (`whisper-large-v3-turbo`), same output contract.
 *
 * No endpoint, model id, weight or template string for transcription lives
 * outside this file.
 */

import { MODELS } from "./ai-models.js";
import { PRICE_BOOK, ZERO } from "./money.js";

export const TRANSCRIPTION_TIER = Object.freeze({
  /** local Whisper + LLM correction — the default, free. */
  primary: "primary",
  /** Groq module — paid, pay-as-you-go. */
  paid: "paid",
} as const);
export type TranscriptionTier = (typeof TRANSCRIPTION_TIER)[keyof typeof TRANSCRIPTION_TIER];

/** ASR providers reachable over an OpenAI-compatible `/audio/transcriptions`. */
export const ASR_PROVIDER = Object.freeze({
  whisperLocal: {
    key: "whisperLocal",
    modelKey: "whisperLocal",
    tier: TRANSCRIPTION_TIER.primary,
    baseUrl: "http://127.0.0.1:9000",
    transcriptionPath: "/v1/audio/transcriptions",
    modelId: MODELS.whisperLocal.id,
    costPerMinute: ZERO,
    live: false,
  },
  groq: {
    key: "groq",
    modelKey: "audioTranscription",
    tier: TRANSCRIPTION_TIER.paid,
    baseUrl: "https://api.groq.com/openai/v1",
    transcriptionPath: "/audio/transcriptions",
    modelId: MODELS.audioTranscription.id,
    costPerMinute: PRICE_BOOK.audioTranscriptionPerMinute,
    live: false,
  },
} as const);
export type AsrProviderKey = keyof typeof ASR_PROVIDER;

/**
 * The correction step. The LLM must stay faithful: fix ASR errors, never
 * paraphrase, never add content, mark uncertainty, and surface anything it
 * cannot ground.
 */
export const CORRECTION = Object.freeze({
  modelKey: "transcriptCorrector",
  modelId: MODELS.transcriptCorrector.id,
  live: false,
  temperature: 0,
  /** Uncertain spans are wrapped like this in the corrected text. */
  uncertaintyMarker: { open: "[?", close: "]" },
  /** Max fraction of characters that may change vs. the raw before we flag it. */
  maxEditRatio: 0.35,
  /** Cost: free while the corrector runs locally. */
  costPerThousandTokens: ZERO,
} as const);

/**
 * Prompt-assembly mechanisms — the ordered context contributors. Each section
 * has a stable id, a role, a fixed heading and (optionally) a static body; the
 * dynamic bodies (glossary, patient context, raw transcript…) are filled by the
 * transcription agent from the read models.
 */
export const PROMPT_SECTION = Object.freeze([
  {
    id: "role",
    heading: "PAPEL",
    body:
      "Você é um revisor de transcrição clínica em português do Brasil. Você corrige erros de " +
      "reconhecimento automático de fala (ASR) sem alterar o sentido, sem parafrasear e sem " +
      "adicionar conteúdo que não esteja no áudio.",
  },
  {
    id: "task",
    heading: "TAREFA",
    body:
      "Receba a transcrição bruta do Whisper e o contexto. Devolva a transcrição corrigida " +
      "preservando as falas na ordem original. Marque trechos incertos com [?...]. Liste todas as " +
      "correções feitas (de → para → motivo).",
  },
  { id: "glossary", heading: "GLOSSÁRIO CONHECIDO (use para desambiguar)", dynamic: true },
  { id: "patient_context", heading: "CONTEXTO DO PACIENTE E DA CONSULTA", dynamic: true },
  { id: "prior_transcripts", heading: "TRANSCRIÇÕES ANTERIORES DO MESMO PACIENTE", dynamic: true, optional: true },
  { id: "few_shot", heading: "EXEMPLOS DE CORREÇÃO (antes → depois)", dynamic: true },
  {
    id: "constraints",
    heading: "RESTRIÇÕES",
    body:
      "1. Não invente nomes, doses ou fatos. 2. Não remova hesitações relevantes (pausas, '...'). " +
      "3. Se encontrar um termo, nome ou sigla que NÃO esteja no glossário e NÃO seja claramente " +
      "português comum, coloque-o em `unknowns` com uma breve justificativa — não o corrija por " +
      "conta própria. 4. Se a solicitação pedir algo que você não pode fazer com segurança, " +
      "responda apenas com `needsExplanation` descrevendo o que falta.",
  },
  {
    id: "output_contract",
    heading: "FORMATO DA RESPOSTA (JSON estrito)",
    body:
      '{ "correctedText": string, "corrections": [{ "from": string, "to": string, "reason": string }], ' +
      '"uncertainSpans": string[], "unknowns": [{ "term": string, "why": string }], ' +
      '"confidence": number (0..1), "needsExplanation"?: string }',
  },
  { id: "raw_transcript", heading: "TRANSCRIÇÃO BRUTA (WHISPER)", dynamic: true },
] as const);
export type PromptSectionId = (typeof PROMPT_SECTION)[number]["id"];

/** Canonical before→after correction pairs injected as few-shot examples. */
export const CORRECTION_EXAMPLES: ReadonlyArray<{ before: string; after: string; reason: string }> =
  Object.freeze([
    {
      before: "eu tô com muita and ciência ultimamente",
      after: "eu tô com muita ansiedade ultimamente",
      reason: "'and ciência' é 'ansiedade' mal segmentado",
    },
    {
      before: "a dra ana pra do me atendeu",
      after: "a Dra. Ana Prado me atendeu",
      reason: "nome de profissional conhecido no glossário",
    },
    {
      before: "tive uma crise de pá nico no trabalho",
      after: "tive uma crise de pânico no trabalho",
      reason: "'pá nico' → 'pânico'",
    },
  ]);

/** What the response guard treats as "outside the request/known". */
export const SCOPE_GUARD = Object.freeze({
  /** If the model returns any of these, ask for an explanation before accepting. */
  triggers: {
    hasUnknowns: true,
    hasNeedsExplanation: true,
    editRatioAbove: CORRECTION.maxEditRatio,
    addedSentencesNotInRaw: true,
    confidenceBelow: 0.55,
  },
  /** Where the clarification request is published. */
  clarificationReason: "transcript-correction-out-of-scope",
} as const);
