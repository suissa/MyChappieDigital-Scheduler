/**
 * Speech synthesis as code — ElevenLabs.
 *
 * The Agente Assistente can reply with audio: the professional's own voice, a
 * cloned voice, or the reply translated into any language then spoken. Every
 * endpoint, model id, voice mode and the character→cost rule lives here.
 */

import { MODELS } from "./ai-models.js";
import { ZERO, type Money } from "./money.js";

export const ELEVENLABS = Object.freeze({
  live: false,
  baseUrl: "https://api.elevenlabs.io",
  ttsPath: "/v1/text-to-speech", // + /{voiceId}
  dubbingPath: "/v1/dubbing",
  voicesPath: "/v1/voices",
  modelId: MODELS.speechSynthesis.id,
  outputFormat: "mp3_44100_128",
  /** 1 credit per character; the Starter plan bundles 30k credits/month. */
  creditsPerCharacter: 1,
  monthlyCreditBudget: 30_000,
  /** ~150 words ≈ ~950 chars ≈ 1 minute of speech. */
  charsPerMinute: 950,
} as const);

export const VOICE_MODE = Object.freeze({
  /** A pre-selected voice from the ElevenLabs library. */
  library: "library",
  /** The professional's own voice (Instant Voice Cloning). */
  cloned: "cloned",
} as const);
export type VoiceMode = (typeof VOICE_MODE)[keyof typeof VOICE_MODE];

/** Default library voice id used when a professional has no cloned voice yet. */
export const DEFAULT_LIBRARY_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

/**
 * Translation for cross-language replies. When the target language differs from
 * the source, translate first (see `translate-text` behaviour) then synthesize,
 * or use ElevenLabs Dubbing for a one-shot voice-preserving translation.
 */
export const SPEECH_TRANSLATION = Object.freeze({
  translatorModelId: MODELS.translator.id,
  live: false,
  /** BCP-47-ish tags the system accepts as a target. `*` = any (best-effort). */
  supportedTargets: ["pt-BR", "en", "es", "fr", "de", "it", "*"] as const,
  defaultSource: "pt-BR",
  /** Prefer ElevenLabs Dubbing (keeps the timbre) over translate-then-TTS. */
  preferDubbing: true,
} as const);

/**
 * Credits a synthesis job consumes (1 per character) and its marginal money
 * cost. The Starter account is a fixed monthly fee (`PRICE_BOOK`), so the
 * marginal cost of a single job is zero — quota, not price, is the constraint.
 */
export const speechCredits = (characterCount: number): number =>
  characterCount * ELEVENLABS.creditsPerCharacter;

export const speechMarginalCost = (_characterCount: number): Money => ZERO;

export const estimatedSpeechMinutes = (characterCount: number): number =>
  characterCount / ELEVENLABS.charsPerMinute;
