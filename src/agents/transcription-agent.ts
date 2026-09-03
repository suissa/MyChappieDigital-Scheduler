/**
 * Transcription agent — the local-Whisper + LLM-correction pipeline
 * (`transcript-correction.flow`).
 *
 *   TranscribeAudio → AssembleCorrectionPrompt → CorrectWithLlm → GuardCorrection
 *     → [?ResolveClarification]  → FinalizeTranscript
 *
 * The prompt is assembled from many context contributors (glossary, patient
 * context, prior transcripts, few-shot pairs, constraints). Anything the model
 * returns that is out of scope / unknown flips the guard and the flow asks a
 * human for an explanation before finalizing.
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { PROJECTION } from "../../config/projections.js";
import { ALL_CONDITIONS, CONDITION_LEXICON } from "../../config/clinical.js";
import { CORRECTION_EXAMPLES, TRANSCRIPTION_TIER } from "../../config/transcription.js";
import { transcriptionRequestedSchema } from "../domain/events.js";
import { ID } from "../kernel/ids.js";

interface Raw {
  text: string;
  costCentavos: number;
  modelId: string;
  providerKey: string;
  simulated: boolean;
}
interface Assembled {
  prompt: string;
  includedSections: string[];
  skippedSections: string[];
  estimatedTokens: number;
}
interface Completion {
  raw: string;
  json?: unknown;
  parsedOk: boolean;
  tokensIn: number;
  tokensOut: number;
  simulated: boolean;
}
interface Guarded {
  inScope: boolean;
  violations: Array<{ rule: string; detail: string }>;
  clarificationItems: Array<{ term: string; why: string }>;
  question?: string;
  editRatio: number;
  confidence: number;
}
interface Gate {
  decision: "approved" | "rejected";
  reviewer: string;
  timedOut: boolean;
}

const glossaryBody = (professionalNames: readonly string[]): string => {
  const conditions = (ALL_CONDITIONS as readonly string[]).join(", ");
  const lex = Object.entries(CONDITION_LEXICON)
    .map(([k, v]) => `- ${k}: ${(v as readonly string[]).join(", ")}`)
    .join("\n");
  const pros = professionalNames.length ? `\nProfissionais: ${professionalNames.join(", ")}` : "";
  return `Condições operacionais: ${conditions}\n${lex}${pros}`;
};

const fewShotBody = (): string =>
  CORRECTION_EXAMPLES.map((e) => `- «${e.before}» → «${e.after}»  (${e.reason})`).join("\n");

export const transcriptionAgent = defineAgent({
  label: AGENT.transcription,
  context: CONTEXT_LABEL.transcription,
  tools: [
    "whisperLocalTranscriber",
    "groqTranscriber",
    "correctionPromptAssembler",
    "transcriptCorrector",
    "transcriptScopeGuard",
    "clarificationGate",
    "transcriptProjectionWriter",
    "clarificationProjectionWriter",
  ],
  subscriptions: [
    {
      subject: SUBJECTS.transcriptionRequested,
      queueGroup: CONSUMER_GROUP.transcription,
      async handle(raw, ctx) {
        const req = transcriptionRequestedSchema.parse(raw);
        const transcriberTool =
          req.tier === TRANSCRIPTION_TIER.paid ? "groqTranscriber" : "whisperLocalTranscriber";

        // 1) Whisper draft
        const draft = await ctx.invokeTool<
          { audioRef: string; durationSeconds: number; language?: string; offlineTranscript?: string },
          Raw
        >(transcriberTool, {
          audioRef: req.audioRef,
          durationSeconds: req.durationSeconds,
          language: req.language,
          ...(req.offlineRaw ? { offlineTranscript: req.offlineRaw } : {}),
        });
        if (!draft.ok) {
          ctx.logger.error("whisper draft failed", { error: draft.error });
          return;
        }
        const rawText = draft.value.text;
        await ctx.emit(SUBJECTS.transcriptDrafted, {
          transcriptId: req.transcriptId,
          audioRef: req.audioRef,
          text: rawText,
          providerKey: draft.value.providerKey,
          modelId: draft.value.modelId,
          costCentavos: draft.value.costCentavos,
          simulated: draft.value.simulated,
        });

        // 2) Assemble the correction prompt from every context contributor
        const dynamic: Record<string, string> = {
          glossary: glossaryBody(req.context.professionalNames),
          patient_context: [
            req.context.patientName ? `Paciente: ${req.context.patientName}` : "",
            req.context.dominantCondition ? `Foco clínico: ${req.context.dominantCondition}` : "",
          ]
            .filter(Boolean)
            .join("\n") || "(sem contexto adicional)",
          few_shot: fewShotBody(),
          raw_transcript: rawText,
        };
        if (req.context.priorTranscripts.length > 0) {
          dynamic["prior_transcripts"] = req.context.priorTranscripts.join("\n---\n");
        }

        const assembled = await ctx.invokeTool<{ dynamic: Record<string, string> }, Assembled>(
          "correctionPromptAssembler",
          { dynamic },
        );
        if (!assembled.ok) {
          ctx.logger.error("prompt assembly failed", { error: assembled.error });
          return;
        }

        // 3) LLM correction
        const corrected = await ctx.invokeTool<
          { prompt: string; offlineCompletion?: string },
          Completion
        >("transcriptCorrector", {
          prompt: assembled.value.prompt,
          ...(req.offlineCorrection ? { offlineCompletion: req.offlineCorrection } : {}),
        });
        if (!corrected.ok) {
          ctx.logger.error("llm correction failed", { error: corrected.error });
          return;
        }
        const response = (corrected.value.json ?? {}) as Record<string, unknown>;

        // 4) Scope guard
        const guarded = await ctx.invokeTool<
          {
            response: Record<string, unknown>;
            sourceText: string;
            producedTextField: string;
            knownVocabulary: string[];
          },
          Guarded
        >("transcriptScopeGuard", {
          response,
          sourceText: rawText,
          producedTextField: "correctedText",
          knownVocabulary: [
            ...(ALL_CONDITIONS as readonly string[]),
            ...req.context.professionalNames,
            ...Object.values(CONDITION_LEXICON).flat(),
          ],
        });
        if (!guarded.ok) {
          ctx.logger.error("scope guard failed", { error: guarded.error });
          return;
        }

        let clarificationId: string | undefined;
        let acceptCorrected = guarded.value.inScope;

        // 5) Gate — ask for an explanation when out of scope
        if (!guarded.value.inScope) {
          clarificationId = ID.review().replace("rev_", "clr_");
          await ctx.invokeTool<{ key: string; patch: Record<string, unknown> }, { version: number }>(
            "clarificationProjectionWriter",
            {
              key: clarificationId,
              patch: {
                transcriptId: req.transcriptId,
                audioRef: req.audioRef,
                items: guarded.value.clarificationItems,
                question: guarded.value.question,
                status: "open",
              },
            },
          );
          await ctx.emit(SUBJECTS.clarificationRequested, {
            clarificationId,
            transcriptId: req.transcriptId,
            items: guarded.value.clarificationItems,
            question: guarded.value.question ?? "Explique os itens fora do escopo.",
          });

          const gate = await ctx.invokeTool<
            { subjectRef: string; question: string; context: Record<string, unknown> },
            Gate
          >("clarificationGate", {
            subjectRef: clarificationId,
            question: guarded.value.question ?? "Aceitar a correção proposta?",
            context: { violations: guarded.value.violations, items: guarded.value.clarificationItems },
          });
          acceptCorrected = gate.ok && gate.value.decision === "approved";
          await ctx.emit(SUBJECTS.clarificationResolved, {
            clarificationId,
            transcriptId: req.transcriptId,
            decision: acceptCorrected ? "accept" : "keep-raw",
            ...(gate.ok ? { reviewer: gate.value.reviewer } : { reviewer: "system:error" }),
          });
        }

        // 6) Finalize
        const correctedText =
          acceptCorrected && typeof response["correctedText"] === "string"
            ? (response["correctedText"] as string)
            : rawText;
        const corrections = Array.isArray(response["corrections"])
          ? (response["corrections"] as unknown[])
          : [];

        await ctx.invokeTool<{ key: string; patch: Record<string, unknown> }, { version: number }>(
          "transcriptProjectionWriter",
          {
            key: req.audioRef,
            patch: {
              transcriptId: req.transcriptId,
              rawText,
              correctedText,
              corrections,
              confidence: guarded.value.confidence,
              inScope: guarded.value.inScope,
              provider: draft.value.providerKey,
              ...(clarificationId ? { clarificationId } : {}),
            },
          },
        );

        await ctx.emit(SUBJECTS.transcriptFinalized, {
          transcriptId: req.transcriptId,
          audioRef: req.audioRef,
          rawText,
          correctedText,
          correctionCount: corrections.length,
          confidence: guarded.value.confidence,
          inScope: guarded.value.inScope,
          ...(clarificationId ? { clarificationId } : {}),
          costCentavos: draft.value.costCentavos,
        });
      },
    },
  ],
});
