/**
 * Product tiers & quotas as code — the three "Camadas" of docs/prompts/00.md.
 * Consumed by billing/quota behaviours (declared, not yet in the vertical slice).
 */

import { PRICE_BOOK, ZERO, type Money } from "./money.js";

export interface AssistantQuota {
  readonly textRepliesPerPatientMonth: number;
  readonly patientAudioTranscriptionMinutesMonth: number;
  readonly clonedVoiceRepliesPerPatientMonth: number;
  readonly clonedVoiceMinutesMonth: number;
  readonly includesVideoEmotion: boolean;
  readonly monthlyAddOn: Money;
}

export interface PlanTier {
  readonly key: string;
  readonly label: string;
  readonly consultaPrice: Money;
  readonly assistant: AssistantQuota;
}

export const PLAN_TIERS = Object.freeze({
  camada1: {
    key: "camada1",
    label: "Consulta base",
    consultaPrice: PRICE_BOOK.consultaBase,
    assistant: {
      textRepliesPerPatientMonth: 30,
      patientAudioTranscriptionMinutesMonth: 100,
      clonedVoiceRepliesPerPatientMonth: 0,
      clonedVoiceMinutesMonth: 0,
      includesVideoEmotion: false,
      monthlyAddOn: PRICE_BOOK.camada1AudioAddonMonthly,
    },
  },
  camada2: {
    key: "camada2",
    label: "IA avançada (opcional)",
    consultaPrice: PRICE_BOOK.consultaBase,
    assistant: {
      textRepliesPerPatientMonth: 30,
      patientAudioTranscriptionMinutesMonth: 100,
      clonedVoiceRepliesPerPatientMonth: 10,
      clonedVoiceMinutesMonth: 0,
      includesVideoEmotion: true,
      monthlyAddOn: ZERO,
    },
  },
  camada3: {
    key: "camada3",
    label: "Automações premium",
    consultaPrice: PRICE_BOOK.consultaBase,
    assistant: {
      textRepliesPerPatientMonth: 30,
      patientAudioTranscriptionMinutesMonth: 30,
      clonedVoiceRepliesPerPatientMonth: 50,
      clonedVoiceMinutesMonth: 30,
      includesVideoEmotion: true,
      monthlyAddOn: PRICE_BOOK.camada3AudioAddonMonthly,
    },
  },
} as const satisfies Record<string, PlanTier>);

export type PlanKey = keyof typeof PLAN_TIERS;
export const DEFAULT_PLAN: PlanKey = "camada1";
