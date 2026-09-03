/**
 * AtomicBehaviour: Audio.transcribe (generic speech-to-text).
 *
 * Provider-agnostic: `providerKey` selects an ASR endpoint from
 * `config/transcription.ts` — `whisperLocal` (free, primary) or `groq` (paid
 * module). Routes through `ctx.ai.transcribe`; offline it returns a
 * deterministic stand-in plus the pay-as-you-go cost so quota/billing
 * behaviours downstream still see a number.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";
import { SUBJECTS } from "../../../../config/subjects.js";

const configSchema = z.object({
  /** Key into `config/transcription.ts` ASR_PROVIDER (whisperLocal | groq). */
  providerKey: z.string(),
  modelId: z.string(),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  audioRef: z.string().min(1),
  durationSeconds: z.number().positive(),
  language: z.string().optional(),
  /** Placeholder transcript used when the provider is not live. */
  offlineTranscript: z.string().optional(),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  text: z.string(),
  costCentavos: z.number().int().nonnegative(),
  modelId: z.string(),
  providerKey: z.string(),
  simulated: z.boolean(),
});
type Output = z.infer<typeof outputSchema>;

export const transcribeAudio = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.transcribeAudio,
    version: "1.1.0",
    types: { input: SEMANTIC_TYPE.audioRef, output: SEMANTIC_TYPE.rawTranscript },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.intake, AGENT.transcription],
      humanInTheLoop: false,
    },
    events: { listen: [SUBJECTS.audioAttached, SUBJECTS.transcriptionRequested], emit: [SUBJECTS.transcriptDrafted] },
    execution: { state: "stateless", sandbox: true, idempotent: true },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    const res = await ctx.ai.transcribe({
      providerKey: config.providerKey,
      audioRef: input.audioRef,
      durationSeconds: input.durationSeconds,
      ...(input.language ? { language: input.language } : {}),
      ...(input.offlineTranscript ? { offlineTranscript: input.offlineTranscript } : {}),
    });
    return ok({
      text: res.text,
      costCentavos: Math.round(res.costCentavos),
      modelId: res.modelId || config.modelId,
      providerKey: config.providerKey,
      simulated: res.simulated,
    });
  },
});
