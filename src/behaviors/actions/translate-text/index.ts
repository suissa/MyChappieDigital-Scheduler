/**
 * AtomicBehaviour: Text.translate (generic translation).
 *
 * Translates `text` from `from` to `to` via the LLM port. A no-op when the
 * languages already match. Offline it returns a tagged stand-in so the speech
 * pipeline stays exercisable.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";

const configSchema = z.object({
  modelId: z.string(),
  live: z.boolean().default(false),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  text: z.string().min(1),
  from: z.string(),
  to: z.string(),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  text: z.string(),
  from: z.string(),
  to: z.string(),
  translated: z.boolean(),
  simulated: z.boolean(),
});
type Output = z.infer<typeof outputSchema>;

export const translateText = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.translateText,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.correctedTranscript, output: SEMANTIC_TYPE.translatedText },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.voice],
      humanInTheLoop: false,
    },
    events: { listen: [], emit: [] },
    execution: { state: "stateless", sandbox: true, idempotent: true },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    if (input.from === input.to || input.to === "*") {
      return ok({ text: input.text, from: input.from, to: input.to, translated: false, simulated: true });
    }
    const res = await ctx.ai.complete({
      modelId: config.modelId,
      temperature: 0,
      live: config.live,
      prompt:
        `Traduza fielmente de ${input.from} para ${input.to}, sem comentar. Texto:\n${input.text}`,
      offlineCompletion: `[${input.to}] ${input.text}`,
    });
    return ok({
      text: res.text.trim(),
      from: input.from,
      to: input.to,
      translated: true,
      simulated: res.simulated,
    });
  },
});
