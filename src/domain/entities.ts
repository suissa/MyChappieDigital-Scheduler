/** Domain entities for the OpenMental scheduling slice. */

import type {
  ConsultaId,
  IntakeId,
  PatientId,
  ProfessionalId,
  QueueEntryId,
  SlotId,
} from "../kernel/ids.js";
import type { Condition, UrgencyKey } from "../../config/clinical.js";

export interface Patient {
  readonly id: PatientId;
  readonly phone: string;
  readonly displayName: string;
}

export interface Professional {
  readonly id: ProfessionalId;
  readonly displayName: string;
  /** Learned competence per condition, 0..1 (ProfessionalAffinityProjection). */
  readonly affinity: Readonly<Partial<Record<Condition, number>>>;
  /** Historical acceptance rate for assigned patients, 0..1. */
  readonly acceptanceRate: number;
  /** Historical share of late consultas, 0..1. */
  readonly delayRisk: number;
  /** Open slots as ISO datetimes, ascending. */
  readonly openSlots: readonly string[];
  /** Patients routed to this professional in the current fairness window. */
  readonly windowLoad: number;
}

export interface Intake {
  readonly id: IntakeId;
  readonly patientId: PatientId;
  readonly complaintText: string;
  readonly audioRef?: string;
  readonly submittedAt: string;
}

export interface TriageOutcome {
  readonly dominantCondition: Condition;
  readonly conditions: readonly Condition[];
  readonly urgency: UrgencyKey;
  readonly crisis: boolean;
  readonly rationale: string;
}

export interface MatchCandidate {
  readonly professionalId: ProfessionalId;
  readonly score: number;
  readonly components: Readonly<{
    affinity: number;
    availability: number;
    fairness: number;
    acceptanceRate: number;
    workloadPenalty: number;
    delayRiskPenalty: number;
  }>;
}

export interface QueueEntry {
  readonly id: QueueEntryId;
  readonly patientId: PatientId;
  readonly professionalId: ProfessionalId;
  readonly position: number;
  readonly etaMinutes: number;
  readonly condition: Condition;
  readonly urgency: UrgencyKey;
}

export interface Consulta {
  readonly id: ConsultaId;
  readonly patientId: PatientId;
  readonly professionalId: ProfessionalId;
  readonly slotId: SlotId;
  readonly scheduledFor: string;
  readonly priceCentavos: number;
}
