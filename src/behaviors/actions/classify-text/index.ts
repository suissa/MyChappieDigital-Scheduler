/**
 * AtomicBehaviour: Complaint.classify (generic text classifier).
 *
 * Generic keyword/lexicon classifier. Bound by the Triage agent to the clinical
 * condition lexicon, but nothing here knows about mental health — it maps text
 * to labels given a lexicon, with an optional escalation lexicon that forces a
 * flag and a dedicated label.
 *
 * The AI-native boundary: a model would replace the lexicon match; the semantic
 * output (labels + escalation flag) and its schema stay identical.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";
import { SUBJECTS } from "../../../../config/subjects.js";

const configSchema = z.object({
  lexicon: z.record(z.string(), z.array(z.string()).min(1)),
  fallbackLabel: z.string(),
  escalation: z
    .object({ phrases: z.array(z.string()).min(1), label: z.string() })
    .optional(),
  /** Secondary label lexicon that raises severity without escalation. */
  severity: z.record(z.string(), z.array(z.string())).optional(),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({ text: z.string().min(1) });
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  labels: z.array(z.string()).min(1),
  dominant: z.string(),
  severityHits: z.array(z.string()),
  escalated: z.boolean(),
  matchedPhrases: z.array(z.string()),
  rationale: z.string(),
});
type Output = z.infer<typeof outputSchema>;

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const normalize = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");

export const classifyText = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.classifyComplaint,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.complaintText, output: SEMANTIC_TYPE.triageResult },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.triage],
      humanInTheLoop: false,
    },
    events: { listen: [SUBJECTS.triageRequested], emit: [SUBJECTS.triageCompleted] },
    execution: { state: "stateless", sandbox: true, idempotent: true },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(_ctx, config, input) {
    const hay = normalize(input.text);
    const matchedLabels: string[] = [];
    const scorePerLabel: Record<string, number> = {};

    for (const [label, phrases] of Object.entries(config.lexicon)) {
      let hits = 0;
      for (const phrase of phrases) if (hay.includes(normalize(phrase))) hits += 1;
      if (hits > 0) {
        matchedLabels.push(label);
        scorePerLabel[label] = hits;
      }
    }

    const escalationHits: string[] = [];
    if (config.escalation) {
      for (const phrase of config.escalation.phrases) {
        if (hay.includes(normalize(phrase))) escalationHits.push(phrase);
      }
    }

    const severityHits: string[] = [];
    for (const [, phrases] of Object.entries(config.severity ?? {})) {
      for (const phrase of phrases) if (hay.includes(normalize(phrase))) severityHits.push(phrase);
    }

    const escalated = escalationHits.length > 0;
    let labels = matchedLabels.length > 0 ? matchedLabels : [config.fallbackLabel];
    if (escalated && config.escalation) labels = [config.escalation.label, ...labels];

    const dominant =
      escalated && config.escalation
        ? config.escalation.label
        : [...matchedLabels].sort((a, b) => (scorePerLabel[b] ?? 0) - (scorePerLabel[a] ?? 0))[0] ??
          config.fallbackLabel;

    return ok({
      labels: [...new Set(labels)],
      dominant,
      severityHits: [...new Set(severityHits)],
      escalated,
      matchedPhrases: escalationHits,
      rationale:
        `matched ${matchedLabels.length} label(s); ` +
        `severity hits ${severityHits.length}; escalation ${escalated ? "YES" : "no"}`,
    });
  },
});
