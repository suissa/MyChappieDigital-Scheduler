/**
 * Intake agent — node `ReceiveIntake`.
 *
 * Normalises the submission, transcribes attached audio (Audio.transcribe tool)
 * and folds the transcript into the complaint text, persists an intake record
 * that every downstream node reads, then emits `triageRequested`.
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { PROJECTION } from "../../config/projections.js";
import { intakeSubmittedSchema, type IntakeSubmitted } from "../domain/events.js";

export interface IntakeRecord {
  readonly intakeId: string;
  readonly patient: IntakeSubmitted["patient"];
  readonly complaintText: string;
  readonly submittedAt: string;
  readonly transcriptCostCentavos: number;
}

export const intakeAgent = defineAgent({
  label: AGENT.intake,
  context: CONTEXT_LABEL.intake,
  tools: ["whisperLocalTranscriber"],
  subscriptions: [
    {
      subject: SUBJECTS.intakeSubmitted,
      queueGroup: CONSUMER_GROUP.intake,
      async handle(raw, ctx) {
        const intake = intakeSubmittedSchema.parse(raw);
        let complaintText = intake.complaintText;
        let transcriptCostCentavos = 0;

        if (intake.audioRef) {
          const res = await ctx.invokeTool<
            { audioRef: string; durationSeconds: number; offlineTranscript?: string },
            { text: string; costCentavos: number; modelId: string; providerKey: string; simulated: boolean }
          >("whisperLocalTranscriber", {
            audioRef: intake.audioRef,
            durationSeconds: intake.audioDurationSeconds ?? 60,
            ...(intake.offlineTranscript ? { offlineTranscript: intake.offlineTranscript } : {}),
          });
          if (res.ok && res.value.text) {
            complaintText = `${complaintText}\n${res.value.text}`.trim();
            transcriptCostCentavos = res.value.costCentavos;
            ctx.logger.info("audio transcribed", {
              model: res.value.modelId,
              provider: res.value.providerKey,
              costCentavos: transcriptCostCentavos,
              simulated: res.value.simulated,
            });
          } else if (!res.ok) {
            ctx.logger.warn("transcription failed; continuing with text only", { error: res.error });
          }
        }

        const record: IntakeRecord = {
          intakeId: intake.intakeId,
          patient: intake.patient,
          complaintText,
          submittedAt: intake.submittedAt,
          transcriptCostCentavos,
        };
        await ctx.kv.put(`projection:${PROJECTION.intake}`, intake.intakeId, record);

        await ctx.emit(SUBJECTS.triageRequested, {
          intakeId: intake.intakeId,
          patientId: intake.patient.id,
          complaintText,
          ...(intake.audioRef ? { audioRef: intake.audioRef } : {}),
          transcriptCostCentavos,
        });
      },
    },
  ],
});
