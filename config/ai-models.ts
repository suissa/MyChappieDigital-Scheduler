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
  voiceCloning: "voice-cloning",
  multimodalEmotion: "multimodal-emotion",
} as const);
export type ModelRole = (typeof MODEL_ROLE)[keyof typeof MODEL_ROLE];

export interface ModelSpec {
  readonly key: string;
  readonly id: string;
  readonly provider: ModelProvider;
  readonly role: ModelRole;
  readonly authoritative: false;
  readonly unitCost: Money;
  readonly unit: "per-minute-audio" | "per-consulta" | "per-message" | "per-account-month";
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
  audioTranscription: {
    key: "audioTranscription",
    id: "whisper-large-v3-turbo",
    provider: MODEL_PROVIDER.groq,
    role: MODEL_ROLE.transcription,
    authoritative: false,
    unitCost: PRICE_BOOK.audioTranscriptionPerMinute,
    unit: "per-minute-audio",
    notes: "Pay-as-you-go, fora do plano grátis.",
  },
  voiceCloning: {
    key: "voiceCloning",
    id: "elevenlabs-instant-voice-cloning",
    provider: MODEL_PROVIDER.elevenlabs,
    role: MODEL_ROLE.voiceCloning,
    authoritative: false,
    unitCost: PRICE_BOOK.elevenLabsAccountMonthly,
    unit: "per-account-month",
    notes: "Conta individual Starter por profissional; 10.000 caracteres/mês.",
  },
  multimodalEmotion: {
    key: "multimodalEmotion",
    id: "qwen3.5-flash",
    provider: MODEL_PROVIDER.google,
    role: MODEL_ROLE.multimodalEmotion,
    authoritative: false,
    unitCost: PRICE_BOOK.videoEmotionAnalysisPerConsulta,
    unit: "per-consulta",
    notes: "Pipeline: MediaPipe -> OpenFace -> wav2vec emotion -> Qwen. GPU sob demanda.",
  },
  intentClassifier: {
    key: "intentClassifier",
    id: "medgemma-1.5",
    provider: MODEL_PROVIDER.local,
    role: MODEL_ROLE.intentClassification,
    authoritative: false,
    unitCost: ZERO,
    unit: "per-message",
    notes: "Classificação de intenção da triagem; nunca decide o domínio sozinho.",
  },
} as const satisfies Record<string, ModelSpec>);

export type ModelKey = keyof typeof MODELS;
