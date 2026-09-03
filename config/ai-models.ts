/**
 * AI model registry as code. Model ids, providers, roles and unit economics
 * from docs/prompts/00.md. Behaviours reference a model by its catalog key,
 * never by a literal id string.
 *
 * The AI-native boundary (AGENTS.md §19): models interpret; the semantic
 * runtime rules the domain. Every entry declares `authoritative: false`.
 */

import { PRICE_BOOK, ZERO, type Money } from "./money.js";

export const MODEL_PROVIDER = Object.freeze({
  groq: "groq",
  google: "google",
  elevenlabs: "elevenlabs",
  local: "local",
} as const);
export type ModelProvider = (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER];

export const MODEL_ROLE = Object.freeze({
  intentClassification: "intent-classification",
  patientUnderstanding: "patient-understanding",
  transcription: "transcription",
  transcriptCorrection: "transcript-correction",
  speechSynthesis: "speech-synthesis",
  translation: "translation",
  voiceCloning: "voice-cloning",
  multimodalEmotion: "multimodal-emotion",
} as const);
export type ModelRole = (typeof MODEL_ROLE)[keyof typeof MODEL_ROLE];

export const MODEL_UNIT = Object.freeze({
  perMinuteAudio: "per-minute-audio",
  perConsulta: "per-consulta",
  perMessage: "per-message",
  perAccountMonth: "per-account-month",
  perThousandChars: "per-1k-chars",
  perThousandTokens: "per-1k-tokens",
  flatFree: "flat-free",
} as const);
export type ModelUnit = (typeof MODEL_UNIT)[keyof typeof MODEL_UNIT];

export interface ModelSpec {
  readonly key: string;
  readonly id: string;
  readonly provider: ModelProvider;
  readonly role: ModelRole;
  readonly authoritative: false;
  readonly unitCost: Money;
  readonly unit: ModelUnit;
  readonly notes: string;
}

export const MODELS = Object.freeze({
  patientAssistant: {
    key: "patientAssistant",
    id: "medgemma-1.5",
    provider: MODEL_PROVIDER.local,
    role: MODEL_ROLE.patientUnderstanding,
    authoritative: false,
    unitCost: PRICE_BOOK.assistantAgentText,
    unit: "per-message",
    notes:
      "Entende as necessidades dos pacientes; aprende a otimizar a interação e alimenta a posição do profissional na fila.",
  },
  /** Primary (free) transcription: local Whisper, then an LLM correction pass. */
  whisperLocal: {
    key: "whisperLocal",
    id: "whisper-large-v3",
    provider: MODEL_PROVIDER.local,
    role: MODEL_ROLE.transcription,
    authoritative: false,
    unitCost: ZERO,
    unit: MODEL_UNIT.flatFree,
    notes:
      "faster-whisper / whisper.cpp servido localmente (OpenAI-compatible ASR). Base do fluxo gratuito.",
  },
  /** LLM that fixes ASR errors against the clinical glossary + context. */
  transcriptCorrector: {
    key: "transcriptCorrector",
    id: "medgemma-1.5",
    provider: MODEL_PROVIDER.local,
    role: MODEL_ROLE.transcriptCorrection,
    authoritative: false,
    unitCost: ZERO,
    unit: MODEL_UNIT.perThousandTokens,
    notes:
      "Corrige a transcrição do Whisper com glossário clínico + contexto do paciente. Nunca inventa; " +
      "marca trechos incertos e lista termos fora do escopo para pedir explicação.",
  },
  /** Paid transcription module: Whisper Large v3 Turbo via Groq. */
  audioTranscription: {
    key: "audioTranscription",
    id: "whisper-large-v3-turbo",
    provider: MODEL_PROVIDER.groq,
    role: MODEL_ROLE.transcription,
    authoritative: false,
    unitCost: PRICE_BOOK.audioTranscriptionPerMinute,
    unit: MODEL_UNIT.perMinuteAudio,
    notes: "Módulo pago, pay-as-you-go, fora do plano grátis.",
  },
  /** ElevenLabs multilingual TTS (own or cloned voice, any language). */
  speechSynthesis: {
    key: "speechSynthesis",
    id: "eleven_multilingual_v2",
    provider: MODEL_PROVIDER.elevenlabs,
    role: MODEL_ROLE.speechSynthesis,
    authoritative: false,
    unitCost: ZERO,
    unit: MODEL_UNIT.perThousandChars,
    notes:
      "1 crédito por caractere (~900-1000 chars/min). Voz própria, clonada (Instant Voice Cloning) " +
      "ou traduzida (Dubbing) para qualquer idioma. Consumo debitado da conta Starter do profissional.",
  },
  /** Translation for cross-language voice replies. */
  translator: {
    key: "translator",
    id: "medgemma-1.5",
    provider: MODEL_PROVIDER.local,
    role: MODEL_ROLE.translation,
    authoritative: false,
    unitCost: ZERO,
    unit: MODEL_UNIT.perThousandTokens,
    notes: "Traduz o texto da resposta antes da síntese quando o idioma alvo difere.",
  },
  voiceCloning: {
    key: "voiceCloning",
    id: "elevenlabs-instant-voice-cloning",
    provider: MODEL_PROVIDER.elevenlabs,
    role: MODEL_ROLE.voiceCloning,
    authoritative: false,
    unitCost: PRICE_BOOK.elevenLabsAccountMonthly,
    unit: MODEL_UNIT.perAccountMonth,
    notes: "Conta individual Starter por profissional; 10.000 caracteres/mês.",
  },
  multimodalEmotion: {
    key: "multimodalEmotion",
    id: "qwen3.5-flash",
    provider: MODEL_PROVIDER.google,
    role: MODEL_ROLE.multimodalEmotion,
    authoritative: false,
    unitCost: PRICE_BOOK.videoEmotionAnalysisPerConsulta,
    unit: MODEL_UNIT.perConsulta,
    notes: "Pipeline: MediaPipe -> OpenFace -> wav2vec emotion -> Qwen. GPU sob demanda.",
  },
  intentClassifier: {
    key: "intentClassifier",
    id: "medgemma-1.5",
    provider: MODEL_PROVIDER.local,
    role: MODEL_ROLE.intentClassification,
    authoritative: false,
    unitCost: ZERO,
    unit: MODEL_UNIT.perMessage,
    notes: "Classificação de intenção da triagem; nunca decide o domínio sozinho.",
  },
} as const satisfies Record<string, ModelSpec>);

export type ModelKey = keyof typeof MODELS;
