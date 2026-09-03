/**
 * AtomicBehaviour: Response.scope.guard.
 *
 * Decides whether an LLM response stayed inside the request and the known
 * vocabulary. Anything outside — flagged unknowns, an explicit
 * `needsExplanation`, too many edits vs. the source, sentences added that
 * aren't in the source, or low confidence — makes `inScope` false and produces
 * clarification items + a question to send back.
 *
 * Generic: the trigger set is config; the response shape is inspected loosely.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";

const configSchema = z.object({
  triggers: z.object({
    hasUnknowns: z.boolean().default(true),
    hasNeedsExplanation: z.boolean().default(true),
    editRatioAbove: z.number().min(0).max(1).default(0.35),
    addedSentencesNotInRaw: z.boolean().default(true),
    confidenceBelow: z.number().min(0).max(1).default(0.55),
  }),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({
  /** The parsed LLM response object. */
  response: z.record(z.string(), z.unknown()),
  /** The source text the response was derived from (e.g. the raw transcript). */
  sourceText: z.string(),
  /** The corrected/produced text field name in `response`. */
  producedTextField: z.string().default("correctedText"),
  /** Terms the model is allowed to use without explanation. */
  knownVocabulary: z.array(z.string()).default([]),
});
type Input = z.infer<typeof inputSchema>;

const violation = z.object({ rule: z.string(), detail: z.string() });
const clarificationItem = z.object({ term: z.string(), why: z.string() });

const outputSchema = z.object({
  inScope: z.boolean(),
  violations: z.array(violation),
  clarificationItems: z.array(clarificationItem),
  question: z.string().optional(),
  editRatio: z.number(),
  confidence: z.number(),
});
type Output = z.infer<typeof outputSchema>;

const norm = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const sentences = (s: string): string[] =>
  s
    .split(/(?<=[.!?…])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 3);

/** Character-level Levenshtein ratio (0 = identical, 1 = completely different). */
const editRatio = (a: string, b: string): number => {
  const s = norm(a);
  const t = norm(b);
  if (s.length === 0 && t.length === 0) return 0;
  const dp = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 0; j <= t.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[s.length]![t.length]! / Math.max(s.length, t.length, 1);
};

export const guardResponse = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.guardResponse,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.llmCompletion, output: SEMANTIC_TYPE.guardedResponse },
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
    const r = input.response;
    const produced = String(r[input.producedTextField] ?? "");
    const confidence = typeof r["confidence"] === "number" ? (r["confidence"] as number) : 1;
    const ratio = Number(editRatio(input.sourceText, produced).toFixed(4));

    const violations: Array<z.infer<typeof violation>> = [];
    const clarificationItems: Array<z.infer<typeof clarificationItem>> = [];

    const rawUnknowns = Array.isArray(r["unknowns"]) ? (r["unknowns"] as unknown[]) : [];
    if (config.triggers.hasUnknowns && rawUnknowns.length > 0) {
      for (const u of rawUnknowns) {
        const o = (u ?? {}) as { term?: unknown; why?: unknown };
        clarificationItems.push({
          term: String(o.term ?? u),
          why: String(o.why ?? "termo fora do glossário"),
        });
      }
      violations.push({ rule: "hasUnknowns", detail: `${rawUnknowns.length} termo(s) fora do glossário` });
    }

    if (config.triggers.hasNeedsExplanation && typeof r["needsExplanation"] === "string" && r["needsExplanation"]) {
      violations.push({ rule: "needsExplanation", detail: String(r["needsExplanation"]) });
    }

    if (ratio > config.triggers.editRatioAbove) {
      violations.push({
        rule: "editRatioAbove",
        detail: `edições em ${(ratio * 100).toFixed(0)}% dos caracteres (limite ${(config.triggers.editRatioAbove * 100).toFixed(0)}%)`,
      });
    }

    if (config.triggers.addedSentencesNotInRaw) {
      const sourceWords = new Set(norm(input.sourceText).match(/[a-zà-ú0-9]+/gi) ?? []);
      const added = sentences(produced).filter((s) => {
        const words = norm(s).match(/[a-zà-ú0-9]+/gi) ?? [];
        if (words.length < 4) return false;
        const overlap = words.filter((w) => sourceWords.has(w)).length / words.length;
        // A genuine correction keeps most of its words from the source.
        return overlap < 0.4;
      });
      if (added.length > 0) {
        violations.push({ rule: "addedSentencesNotInRaw", detail: `${added.length} frase(s) sem base no áudio` });
        for (const a of added.slice(0, 5)) clarificationItems.push({ term: a, why: "frase não encontrada na transcrição bruta" });
      }
    }

    if (confidence < config.triggers.confidenceBelow) {
      violations.push({ rule: "confidenceBelow", detail: `confiança ${confidence} < ${config.triggers.confidenceBelow}` });
    }

    // Any produced token clearly not Portuguese-common and not in the vocabulary.
    const known = new Set(input.knownVocabulary.map(norm));
    const suspicious = [...new Set(norm(produced).match(/[a-zà-ú]{4,}/gi) ?? [])].filter(
      (w) => !known.has(w) && /[qwxyk]/.test(w) === false && /[^a-zà-ú]/.test(w),
    );
    void suspicious; // heuristic hook, not a hard trigger in v1

    const inScope = violations.length === 0;
    return ok({
      inScope,
      violations,
      clarificationItems,
      ...(inScope
        ? {}
        : {
            question:
              "A revisão da transcrição saiu do previsto. Explique os itens abaixo (ou confirme como manter): " +
              clarificationItems.map((c) => `«${c.term}» (${c.why})`).join("; "),
          }),
      editRatio: ratio,
      confidence,
    });
  },
});
