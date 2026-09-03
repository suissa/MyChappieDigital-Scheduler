/**
 * AtomicBehaviour: Prompt.assemble (generic structured-prompt builder).
 *
 * The mechanism for "the best possible prompt with everything the LLM needs".
 * Given an ordered list of section specs (id + heading + static body or a
 * dynamic-body marker) and a map of dynamic bodies, produce one prompt string,
 * a manifest of which sections were included, and an estimated token count.
 * Nothing here is transcription-specific — the section catalog is config.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok, err, domainError } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";

const sectionSpec = z.object({
  id: z.string(),
  heading: z.string(),
  body: z.string().optional(),
  dynamic: z.boolean().optional(),
  optional: z.boolean().optional(),
});

const configSchema = z.object({
  sections: z.array(sectionSpec).min(1),
  /** Divider between sections. */
  divider: z.string().default("\n\n---\n\n"),
  /** Rough chars-per-token for the estimate. */
  charsPerToken: z.number().positive().default(4),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  /** section id -> body text, for every `dynamic` section. */
  dynamic: z.record(z.string(), z.string()),
});
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  prompt: z.string().min(1),
  includedSections: z.array(z.string()),
  skippedSections: z.array(z.string()),
  estimatedTokens: z.number().int().nonnegative(),
});
type Output = z.infer<typeof outputSchema>;

export const assemblePrompt = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.assemblePrompt,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.rawTranscript, output: SEMANTIC_TYPE.assembledPrompt },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.transcription, AGENT.triage, AGENT.voice],
      humanInTheLoop: false,
    },
    events: { listen: [], emit: [] },
    execution: { state: "stateless", sandbox: true, idempotent: true },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(_ctx, config, input) {
    const parts: string[] = [];
    const included: string[] = [];
    const skipped: string[] = [];

    for (const spec of config.sections) {
      let body = spec.body ?? "";
      if (spec.dynamic) {
        const dyn = input.dynamic[spec.id];
        if (dyn === undefined || dyn.trim() === "") {
          if (spec.optional) {
            skipped.push(spec.id);
            continue;
          }
          return err(
            domainError("MISSING_DYNAMIC_SECTION", `required dynamic section '${spec.id}' has no body`, {
              sectionId: spec.id,
            }),
          );
        }
        body = dyn;
      }
      parts.push(`## ${spec.heading}\n${body}`.trim());
      included.push(spec.id);
    }

    const prompt = parts.join(config.divider);
    return ok({
      prompt,
      includedSections: included,
      skippedSections: skipped,
      estimatedTokens: Math.ceil(prompt.length / config.charsPerToken),
    });
  },
});
