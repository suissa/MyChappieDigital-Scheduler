/**
 * AtomicBehaviour: Llm.completion.request (generic LLM call).
 *
 * Sends an assembled prompt to a model via `ctx.ai.complete` and — when the
 * config declares a JSON shape — parses + validates the response. Offline it
 * returns the caller-supplied `offlineCompletion`. Costs are reported in tokens
 * so a quota/billing behaviour downstream can price it.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok, err, domainError } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";

const configSchema = z.object({
  modelId: z.string(),
  temperature: z.number().min(0).max(2).default(0),
  live: z.boolean().default(false),
  /** When true the behaviour parses the response as JSON and fails if it isn't. */
  expectJson: z.boolean().default(true),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  prompt: z.string().min(1),
  offlineCompletion: z.string().optional(),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  raw: z.string(),
  json: z.unknown().optional(),
  parsedOk: z.boolean(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  simulated: z.boolean(),
});
type Output = z.infer<typeof outputSchema>;

const stripFences = (s: string): string =>
  s
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

export const llmComplete = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.completeWithLlm,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.assembledPrompt, output: SEMANTIC_TYPE.llmCompletion },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.transcription, AGENT.triage, AGENT.voice],
      humanInTheLoop: false,
    },
    events: { listen: [], emit: [] },
    execution: { state: "stateless", sandbox: true, idempotent: false },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    const res = await ctx.ai.complete({
      modelId: config.modelId,
      prompt: input.prompt,
      temperature: config.temperature,
      live: config.live,
      ...(input.offlineCompletion ? { offlineCompletion: input.offlineCompletion } : {}),
    });

    if (!config.expectJson) {
      return ok({
        raw: res.text,
        parsedOk: true,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        simulated: res.simulated,
      });
    }

    try {
      const json = JSON.parse(stripFences(res.text)) as unknown;
      return ok({
        raw: res.text,
        json,
        parsedOk: true,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        simulated: res.simulated,
      });
    } catch {
      return err(
        domainError("LLM_RESPONSE_NOT_JSON", "model did not return parseable JSON", {
          rawPreview: res.text.slice(0, 200),
        }),
      );
    }
  },
});
