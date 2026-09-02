/**
 * AtomicBehaviour: Audio.transcribe (generic speech-to-text).
 *
 * Bound by the Intake agent to Whisper Large v3 Turbo via Groq
 * (docs/prompts/00.md). Offline it returns a deterministic placeholder plus the
 * pay-as-you-go cost so quota/billing behaviours downstream still see a number.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";
import { SUBJECTS } from "../../../../config/subjects.js";

const configSchema = z.object({
  modelId: z.string(),
  live: z.boolean(),
  costCentavosPerMinute: z.number().nonnegative(),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  audioRef: z.string().min(1),
  durationSeconds: z.number().positive(),
  /** Placeholder transcript used when `live` is false. */
  offlineTranscript: z.string().optional(),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  text: z.string(),
  costCentavos: z.number().int().nonnegative(),
  modelId: z.string(),
  simulated: z.boolean(),
});
type Output = z.infer<typeof outputSchema>;

export const transcribeAudio = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.transcribeAudio,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.audioRef, output: SEMANTIC_TYPE.transcript },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.intake],
      humanInTheLoop: false,
    },
    events: { listen: [SUBJECTS.audioAttached], emit: [] },
    execution: { state: "stateless", sandbox: true, idempotent: true },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(_ctx, config, input) {
    const minutes = Math.ceil(input.durationSeconds / 60);
    const costCentavos = Math.round(minutes * config.costCentavosPerMinute);
    if (!config.live) {
      return ok({
        text: input.offlineTranscript ?? `[transcrição simulada de ${input.audioRef}]`,
        costCentavos,
        modelId: config.modelId,
        simulated: true,
      });
    }
    // A live Groq call would go here via ctx.http; kept out of the offline slice.
    return ok({ text: "", costCentavos, modelId: config.modelId, simulated: false });
  },
});
