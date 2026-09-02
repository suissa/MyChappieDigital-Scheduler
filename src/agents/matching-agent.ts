/**
 * Matching agent — nodes `ScreenClinicPolicy`, `ScoreAffinity`,
 * `RankProfessional` (the fork-join).
 *
 * Screens the professional pool (policy branch), builds a feature row per
 * candidate, drives Professional.affinity.score then Candidate.rank.topK, and
 * emits `professionalMatched` — or `matchingFailed` when nobody clears the
 * viability threshold. Reflects docs/prompts/00.md: affinity for the patient's
 * dominant condition is the heaviest term, tempered by fairness of load.
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { PROJECTION } from "../../config/projections.js";
import { AFFINITY } from "../../config/scheduling.js";
import { URGENCY, type Condition, type UrgencyKey } from "../../config/clinical.js";
import { matchingRequestedSchema } from "../domain/events.js";
import type { Professional } from "../domain/entities.js";

interface FeatureRow {
  id: string;
  features: Record<string, number>;
  penaltyCounts: Record<string, number>;
}
interface ScoredRow {
  id: string;
  score: number;
  components: Record<string, number>;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** How soon the professional's earliest open slot is, 0..1 (sooner = higher). */
const availabilityScore = (p: Professional, urgency: UrgencyKey, nowMs: number): number => {
  const earliest = [...p.openSlots].sort()[0];
  if (!earliest) return 0;
  const hours = (new Date(earliest).getTime() - nowMs) / 3_600_000;
  const budget = URGENCY[urgency].maxHoursToConsulta;
  return clamp01(1 - hours / budget);
};

const fairnessScore = (p: Professional): number => 1 / (1 + p.windowLoad);

export const matchingAgent = defineAgent({
  label: AGENT.matching,
  context: CONTEXT_LABEL.matching,
  tools: ["affinityScorer", "candidateRanker"],
  subscriptions: [
    {
      subject: SUBJECTS.matchingRequested,
      queueGroup: CONSUMER_GROUP.matching,
      async handle(raw, ctx) {
        const req = matchingRequestedSchema.parse(raw);
        const condition = req.dominantCondition as Condition;
        const urgency = req.urgency as UrgencyKey;
        const nowMs = ctx.clock.nowMs();

        // ScreenClinicPolicy branch: only professionals with an open slot.
        const eligible = ctx.directory.list().filter((p) => p.openSlots.length > 0);
        if (eligible.length === 0) {
          await ctx.emit(SUBJECTS.matchingFailed, {
            intakeId: req.intakeId,
            patientId: req.patientId,
            reason: "no professional with an open slot",
          });
          return;
        }

        const rows: FeatureRow[] = eligible.map((p) => ({
          id: p.id,
          features: {
            affinity: clamp01(p.affinity[condition] ?? AFFINITY.priorScore),
            availability: availabilityScore(p, urgency, nowMs),
            fairness: fairnessScore(p),
            acceptanceRate: clamp01(p.acceptanceRate),
          },
          penaltyCounts: {
            currentWorkload: p.windowLoad,
            delayRisk: p.delayRisk > 0.5 ? 1 : 0,
          },
        }));

        const scored = await ctx.invokeTool<{ candidates: FeatureRow[] }, { scored: ScoredRow[] }>(
          "affinityScorer",
          { candidates: rows },
        );
        if (!scored.ok) {
          await ctx.emit(SUBJECTS.matchingFailed, {
            intakeId: req.intakeId,
            patientId: req.patientId,
            reason: `scoring failed: ${scored.error.code}`,
          });
          return;
        }

        const ranked = await ctx.invokeTool<
          { scored: ScoredRow[] },
          { selected: ScoredRow[]; best?: ScoredRow; rejectedCount: number }
        >("candidateRanker", { scored: scored.value.scored });
        if (!ranked.ok || !ranked.value.best) {
          await ctx.emit(SUBJECTS.matchingFailed, {
            intakeId: req.intakeId,
            patientId: req.patientId,
            reason: ranked.ok ? "no viable candidate" : `ranking failed: ${ranked.error.code}`,
          });
          return;
        }

        const best = ranked.value.best;
        const chosen = ctx.directory.get(best.id)!;
        const earliestSlot = [...chosen.openSlots].sort()[0]!;

        await ctx.invokeTool<
          { key: string; patch: Record<string, unknown> },
          { version: number }
        >("affinityProjectionWriter", {
          key: `${best.id}:${condition}`,
          patch: {
            professionalId: best.id,
            condition,
            affinity: chosen.affinity[condition] ?? AFFINITY.priorScore,
            lastMatchScore: best.score,
          },
        });

        ctx.logger.info("professional matched", {
          intakeId: req.intakeId,
          professionalId: best.id,
          score: best.score,
          condition,
        });

        await ctx.emit(SUBJECTS.professionalMatched, {
          intakeId: req.intakeId,
          patientId: req.patientId,
          professionalId: best.id,
          score: best.score,
          condition,
          urgency,
          earliestSlot,
        });
      },
    },
  ],
});
