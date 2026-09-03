/**
 * Voice agent — the Agente Assistente's audio replies.
 *
 * `speechSynthesisRequested` → (translate when the target language differs) →
 * ElevenLabs synthesis (own / cloned voice) → `speechSynthesized`. Enforces the
 * professional's monthly credit budget via the synthesis behaviour.
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { speechSynthesisRequestedSchema } from "../domain/events.js";

interface Translated {
  text: string;
  from: string;
  to: string;
  translated: boolean;
  simulated: boolean;
}
interface Synth {
  audioRef: string;
  voiceId: string;
  language: string;
  characterCount: number;
  creditsConsumed: number;
  creditsRemaining: number;
  simulated: boolean;
}

export const voiceAgent = defineAgent({
  label: AGENT.voice,
  context: CONTEXT_LABEL.speech,
  tools: ["replyTranslator", "voiceSynthesizer", "speechProjectionWriter"],
  subscriptions: [
    {
      subject: SUBJECTS.speechSynthesisRequested,
      queueGroup: CONSUMER_GROUP.voice,
      async handle(raw, ctx) {
        const req = speechSynthesisRequestedSchema.parse(raw);

        let text = req.text;
        let translated = false;
        if (req.targetLanguage !== req.sourceLanguage && req.targetLanguage !== "*") {
          const tr = await ctx.invokeTool<{ text: string; from: string; to: string }, Translated>(
            "replyTranslator",
            { text: req.text, from: req.sourceLanguage, to: req.targetLanguage },
          );
          if (tr.ok) {
            text = tr.value.text;
            translated = tr.value.translated;
          }
        }

        const creditsUsed =
          (await ctx.kv.get<number>("speech:credits", req.professionalId ?? "shared")) ?? 0;

        const synth = await ctx.invokeTool<
          {
            text: string;
            language: string;
            clonedVoiceId?: string;
            creditsUsedThisMonth: number;
          },
          Synth
        >("voiceSynthesizer", {
          text,
          language: req.targetLanguage,
          ...(req.clonedVoiceId ? { clonedVoiceId: req.clonedVoiceId } : {}),
          creditsUsedThisMonth: creditsUsed,
        });

        if (!synth.ok) {
          ctx.logger.warn("speech synthesis rejected", { error: synth.error, speechId: req.speechId });
          await ctx.emit(SUBJECTS.speechSynthesisFailed, {
            speechId: req.speechId,
            reason: synth.error.message,
          });
          return;
        }

        await ctx.kv.put(
          "speech:credits",
          req.professionalId ?? "shared",
          creditsUsed + synth.value.creditsConsumed,
        );
        await ctx.invokeTool<{ key: string; patch: Record<string, unknown> }, { version: number }>(
          "speechProjectionWriter",
          {
            key: req.speechId,
            patch: {
              audioRef: synth.value.audioRef,
              voiceId: synth.value.voiceId,
              language: synth.value.language,
              characterCount: synth.value.characterCount,
              creditsConsumed: synth.value.creditsConsumed,
              ...(req.consultaId ? { consultaId: req.consultaId } : {}),
              ...(req.professionalId ? { professionalId: req.professionalId } : {}),
              translated,
            },
          },
        );

        await ctx.emit(SUBJECTS.speechSynthesized, {
          speechId: req.speechId,
          audioRef: synth.value.audioRef,
          voiceId: synth.value.voiceId,
          language: synth.value.language,
          characterCount: synth.value.characterCount,
          creditsConsumed: synth.value.creditsConsumed,
          translated,
          simulated: synth.value.simulated,
        });
      },
    },
  ],
});
