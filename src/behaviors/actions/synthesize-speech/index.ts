/**
 * AtomicBehaviour: Speech.synthesize (ElevenLabs TTS).
 *
 * Turns text into audio using the professional's own voice, a cloned voice, or
 * a library voice. Optionally translates first (config), and reports the
 * credits consumed so a quota behaviour can enforce the Starter budget.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok, err, domainError } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";

const configSchema = z.object({
  modelId: z.string(),
  live: z.boolean().default(false),
  voiceMode: z.enum(["library", "cloned"]),
  defaultVoiceId: z.string(),
  creditsPerCharacter: z.number().positive().default(1),
  monthlyCreditBudget: z.number().int().positive(),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  text: z.string().min(1),
  language: z.string().default("pt-BR"),
  /** The professional's cloned voice id, when `voiceMode` is "cloned". */
  clonedVoiceId: z.string().optional(),
  /** Credits already consumed this month, for the budget check. */
  creditsUsedThisMonth: z.number().int().nonnegative().default(0),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  audioRef: z.string(),
  voiceId: z.string(),
  language: z.string(),
  characterCount: z.number().int().nonnegative(),
  creditsConsumed: z.number().int().nonnegative(),
  creditsRemaining: z.number().int(),
  simulated: z.boolean(),
});
type Output = z.infer<typeof outputSchema>;

export const synthesizeSpeech = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.synthesizeSpeech,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.speechRequest, output: SEMANTIC_TYPE.synthesizedSpeech },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.voice],
      humanInTheLoop: false,
    },
    events: {
      listen: [], // wired by the voice agent
      emit: [],
    },
    execution: { state: "stateless", sandbox: true, idempotent: false },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    const characterCount = [...input.text].length;
    const creditsConsumed = Math.ceil(characterCount * config.creditsPerCharacter);
    const creditsRemaining = config.monthlyCreditBudget - input.creditsUsedThisMonth - creditsConsumed;
    if (creditsRemaining < 0) {
      return err(
        domainError("SPEECH_BUDGET_EXCEEDED", "monthly ElevenLabs credit budget would be exceeded", {
          creditsConsumed,
          creditsUsedThisMonth: input.creditsUsedThisMonth,
          monthlyCreditBudget: config.monthlyCreditBudget,
        }),
      );
    }

    const voiceId =
      config.voiceMode === "cloned" && input.clonedVoiceId
        ? input.clonedVoiceId
        : config.defaultVoiceId;

    const res = await ctx.ai.synthesize({
      modelId: config.modelId,
      text: input.text,
      voiceId,
      language: input.language,
      live: config.live,
    });

    return ok({
      audioRef: res.audioRef,
      voiceId,
      language: input.language,
      characterCount: res.characterCount,
      creditsConsumed,
      creditsRemaining,
      simulated: res.simulated,
    });
  },
});
