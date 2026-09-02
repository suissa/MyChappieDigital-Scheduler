/**
 * Demo fixtures — NOT configuration.
 *
 * These are sample actors and payloads for `npm start` and the E2E test. Real
 * deployments never import this file. Values here are illustrative data, not
 * business parameters (those all live in `config/`).
 */

import type { Clock } from "../kernel/clock.js";
import type { Professional } from "../domain/entities.js";
import { CONDITION } from "../../config/clinical.js";
import { MemoryDirectory, type ProfessionalDirectory } from "../domain/directory.js";
import { SLOT } from "../../config/scheduling.js";
import type { ProfessionalId } from "../kernel/ids.js";

const iso = (base: number, hoursFromNow: number): string =>
  new Date(base + hoursFromNow * 3_600_000).toISOString();

export const makeDemoDirectory = (clock: Clock): ProfessionalDirectory => {
  const base = clock.nowMs();
  const slots = (offsets: number[]): string[] => offsets.map((h) => iso(base, h));

  const professionals: Professional[] = [
    {
      id: "pro_ANA" as ProfessionalId,
      displayName: "Dra. Ana Prado",
      affinity: { [CONDITION.ansiedade]: 0.86, [CONDITION.panico]: 0.78, [CONDITION.estresse]: 0.6 },
      acceptanceRate: 0.92,
      delayRisk: 0.12,
      openSlots: slots([3, 5, 27]),
      windowLoad: 2,
    },
    {
      id: "pro_BRU" as ProfessionalId,
      displayName: "Dr. Bruno Lima",
      affinity: { [CONDITION.depressao]: 0.88, [CONDITION.luto]: 0.8, [CONDITION.autoestima]: 0.65 },
      acceptanceRate: 0.85,
      delayRisk: 0.2,
      openSlots: slots([2, 6, 30]),
      windowLoad: 1,
    },
    {
      id: "pro_CAR" as ProfessionalId,
      displayName: "Dra. Carla Nunes",
      affinity: { [CONDITION.trauma]: 0.82, [CONDITION.relacionamento]: 0.7, [CONDITION.ansiedade]: 0.55 },
      acceptanceRate: 0.78,
      delayRisk: 0.55,
      openSlots: slots([1, 4, 26]),
      windowLoad: 4,
    },
  ];

  return new MemoryDirectory(professionals);
};

export const DEMO_SLOT_MINUTES = SLOT.durationMinutes;

export const demoIntake = (clock: Clock) => ({
  patient: { id: "pat_MARIA", phone: "5511999990001", displayName: "Maria" },
  complaintText:
    "Ando com muita ansiedade e preocupacao, nao consigo trabalhar direito essa semana e tenho tido " +
    "taquicardia e falta de ar.",
  submittedAt: clock.nowIso(),
});

export const demoCrisisIntake = (clock: Clock) => ({
  patient: { id: "pat_JOAO", phone: "5511999990002", displayName: "Joao" },
  complaintText:
    "Estou com uma tristeza enorme apos uma perda, e as vezes penso em me machucar. Preciso de ajuda urgente.",
  submittedAt: clock.nowIso(),
});
