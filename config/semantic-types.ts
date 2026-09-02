/**
 * Semantic type names as code.
 *
 * These are the node port types the flow-graph checker compares:
 * an edge `A :--: B` is valid only when `OutputType(A) ≡ InputType(B)`
 * (Lucy-mae 2Flow "Regra de Tipos em Comptime"). They are nominal labels, not
 * TypeScript structural types.
 */

export const SEMANTIC_TYPE = Object.freeze({
  // --- behaviour port types (the generic AtomicBehaviour i/o) ---------------
  complaintText: "Text",
  triageResult: "TriageResult",
  approvalRequest: "ApprovalRequest",
  approvalDecision: "ApprovalDecision",
  candidateFeatureSet: "CandidateFeatureSet",
  scoredCandidateSet: "ScoredCandidateSet",
  ranking: "Ranking",
  matchDecision: "MatchDecision",
  queueInsertRequest: "QueueInsertRequest",
  queuePlacement: "QueuePlacement",
  reservationRequest: "ReservationRequest",
  reservation: "Reservation",
  releaseAck: "ReleaseAck",
  projectionPatch: "ProjectionPatch",
  projectionVersion: "ProjectionVersion",
  outboundMessage: "OutboundMessage",
  deliveryReceipt: "DeliveryReceipt",
  audioRef: "AudioRef",
  transcript: "Transcript",
  void: "Void",

  // --- flow phase types (the data that travels the graph edges) ------------
  // An edge `A :--: B` is valid only when OutputType(A) ≡ InputType(B).
  intakeSubmission: "IntakeSubmission",
  triagedIntake: "TriagedIntake",
  reviewedIntake: "ReviewedIntake",
  matchedIntake: "MatchedIntake",
  queuedIntake: "QueuedIntake",
  scheduledConsulta: "ScheduledConsulta",
  persistedConsulta: "PersistedConsulta",
  confirmedConsulta: "ConfirmedConsulta",
} as const);

export type SemanticType = (typeof SEMANTIC_TYPE)[keyof typeof SEMANTIC_TYPE];

/** Nominal equivalence — currently identity, but the single choke point if
 *  structural sub-typing or aliases are introduced later. */
export const semanticTypesEqual = (a: string, b: string): boolean => a === b;
