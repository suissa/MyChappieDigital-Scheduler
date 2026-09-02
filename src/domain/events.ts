/**
 * Typed event & command catalog.
 *
 * Each subject in `config/subjects.ts` gets exactly one payload schema here.
 * The agent runtime validates every inbound envelope against the schema for its
 * subject before a handler runs (AGENTS.md §16, §33 "Invalid event schema").
 */

import { z } from "zod";
import { SUBJECTS } from "../../config/subjects.js";
import { ALL_CONDITIONS, URGENCY } from "../../config/clinical.js";

const conditionSchema = z.enum(
  ALL_CONDITIONS as unknown as [string, ...string[]],
);
const urgencySchema = z.enum(
  Object.keys(URGENCY) as unknown as [string, ...string[]],
);

const money = z.number().int().nonnegative();
const iso = z.string().datetime();

export const SCHEMA_VERSION = "1.0.0" as const;

export const intakeSubmittedSchema = z.object({
  intakeId: z.string(),
  patient: z.object({ id: z.string(), phone: z.string().min(8), displayName: z.string() }),
  complaintText: z.string().min(1),
  audioRef: z.string().optional(),
  submittedAt: iso,
});

export const triageRequestedSchema = z.object({
  intakeId: z.string(),
  patientId: z.string(),
  complaintText: z.string(),
  audioRef: z.string().optional(),
});

export const triageCompletedSchema = z.object({
  intakeId: z.string(),
  patientId: z.string(),
  dominantCondition: conditionSchema,
  conditions: z.array(conditionSchema).min(1),
  urgency: urgencySchema,
  crisis: z.boolean(),
  rationale: z.string(),
});

export const crisisDetectedSchema = z.object({
  intakeId: z.string(),
  patientId: z.string(),
  matchedPhrases: z.array(z.string()),
});

export const clinicalReviewRequestedSchema = z.object({
  reviewId: z.string(),
  intakeId: z.string(),
  patientId: z.string(),
  reason: z.string(),
});

export const clinicalReviewResolvedSchema = z.object({
  reviewId: z.string(),
  intakeId: z.string(),
  patientId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  reviewer: z.string(),
  note: z.string().optional(),
});

export const matchingRequestedSchema = z.object({
  intakeId: z.string(),
  patientId: z.string(),
  dominantCondition: conditionSchema,
  urgency: urgencySchema,
});

export const professionalMatchedSchema = z.object({
  intakeId: z.string(),
  patientId: z.string(),
  professionalId: z.string(),
  score: z.number(),
  condition: conditionSchema,
  urgency: urgencySchema,
  earliestSlot: iso,
});

export const matchingFailedSchema = z.object({
  intakeId: z.string(),
  patientId: z.string(),
  reason: z.string(),
});

export const queuePositionAssignedSchema = z.object({
  queueEntryId: z.string(),
  intakeId: z.string(),
  patientId: z.string(),
  professionalId: z.string(),
  position: z.number().int().positive(),
  etaMinutes: z.number().nonnegative(),
  condition: conditionSchema,
  urgency: urgencySchema,
});

export const queueProjectionUpdatedSchema = z.object({
  professionalId: z.string(),
  size: z.number().int().nonnegative(),
  entries: z.array(
    z.object({ patientId: z.string(), position: z.number().int(), etaMinutes: z.number() }),
  ),
});

export const slotReservationRequestedSchema = z.object({
  intakeId: z.string(),
  patientId: z.string(),
  professionalId: z.string(),
  slotIso: iso,
});

export const consultaScheduledSchema = z.object({
  consultaId: z.string(),
  intakeId: z.string(),
  patientId: z.string(),
  professionalId: z.string(),
  slotId: z.string(),
  scheduledFor: iso,
  priceCentavos: money,
});

export const slotReservationFailedSchema = z.object({
  intakeId: z.string(),
  patientId: z.string(),
  professionalId: z.string(),
  slotIso: iso,
  reason: z.string(),
  attempts: z.number().int().positive(),
});

export const slotHoldReleasedSchema = z.object({
  intakeId: z.string(),
  professionalId: z.string(),
  slotIso: iso,
});

export const whatsappDispatchRequestedSchema = z.object({
  to: z.string(),
  text: z.string().min(1),
  reason: z.string(),
});

export const whatsappDispatchedSchema = z.object({
  to: z.string(),
  text: z.string(),
  providerMessageId: z.string(),
  simulated: z.boolean(),
});

export const affinityProjectionUpdatedSchema = z.object({
  professionalId: z.string(),
  condition: conditionSchema,
  affinity: z.number().min(0).max(1),
});

export const consultaProjectionUpdatedSchema = z.object({
  consultaId: z.string(),
  patientId: z.string(),
  professionalId: z.string(),
  scheduledFor: iso,
});

/** subject -> payload schema. The runtime looks payloads up by subject here. */
export const EVENT_REGISTRY = Object.freeze({
  [SUBJECTS.intakeSubmitted]: intakeSubmittedSchema,
  [SUBJECTS.triageRequested]: triageRequestedSchema,
  [SUBJECTS.triageCompleted]: triageCompletedSchema,
  [SUBJECTS.crisisDetected]: crisisDetectedSchema,
  [SUBJECTS.clinicalReviewRequested]: clinicalReviewRequestedSchema,
  [SUBJECTS.clinicalReviewResolved]: clinicalReviewResolvedSchema,
  [SUBJECTS.matchingRequested]: matchingRequestedSchema,
  [SUBJECTS.professionalMatched]: professionalMatchedSchema,
  [SUBJECTS.matchingFailed]: matchingFailedSchema,
  [SUBJECTS.queuePositionAssigned]: queuePositionAssignedSchema,
  [SUBJECTS.queueProjectionUpdated]: queueProjectionUpdatedSchema,
  [SUBJECTS.slotReservationRequested]: slotReservationRequestedSchema,
  [SUBJECTS.consultaScheduled]: consultaScheduledSchema,
  [SUBJECTS.slotReservationFailed]: slotReservationFailedSchema,
  [SUBJECTS.slotHoldReleased]: slotHoldReleasedSchema,
  [SUBJECTS.whatsappDispatchRequested]: whatsappDispatchRequestedSchema,
  [SUBJECTS.whatsappDispatched]: whatsappDispatchedSchema,
  [SUBJECTS.affinityProjectionUpdated]: affinityProjectionUpdatedSchema,
  [SUBJECTS.consultaProjectionUpdated]: consultaProjectionUpdatedSchema,
} as const);

export type EventRegistry = typeof EVENT_REGISTRY;
export type KnownSubject = keyof EventRegistry;
export type PayloadOf<S extends KnownSubject> = z.infer<EventRegistry[S]>;

export const schemaForSubject = (subject: string): z.ZodTypeAny | undefined =>
  (EVENT_REGISTRY as Record<string, z.ZodTypeAny>)[subject];

// Convenience payload types used across agents/behaviours.
export type IntakeSubmitted = z.infer<typeof intakeSubmittedSchema>;
export type TriageCompleted = z.infer<typeof triageCompletedSchema>;
export type ClinicalReviewResolved = z.infer<typeof clinicalReviewResolvedSchema>;
export type ProfessionalMatched = z.infer<typeof professionalMatchedSchema>;
export type QueuePositionAssigned = z.infer<typeof queuePositionAssignedSchema>;
export type ConsultaScheduled = z.infer<typeof consultaScheduledSchema>;
