/**
 * Scheduling & fair-queue parameters as code.
 *
 * Mirrors the "Fair Dispatch Score" idea from the delivery prompt, reshaped for
 * clinical routing: proximity-of-skill (affinity) + availability + fairness of
 * load distribution across professionals, minus current workload.
 */

export const SLOT = Object.freeze({
  durationMinutes: 50,
  bufferMinutes: 10,
  businessDayStartHour: 8,
  businessDayEndHour: 20,
  reservationHoldSeconds: 120,
} as const);

export const QUEUE = Object.freeze({
  /** Maximum entries the projection keeps per professional. */
  maxTrackedPerProfessional: 200,
  /** Minutes of expected consulta throughput used for ETA estimation. */
  etaMinutesPerPosition: SLOT.durationMinutes + SLOT.bufferMinutes,
  /** Position 1 means "next". */
  firstPosition: 1,
} as const);

/**
 * Weights for the professional match score. Basis points, must sum to 10_000.
 *   affinity         — learned competence for the patient's dominant condition
 *   availability     — how soon the professional has an open slot
 *   fairness         — inverse of how many patients were routed to them today
 *   acceptanceRate   — historical willingness to take assigned patients
 * Penalties are subtracted after the weighted sum.
 */
export const MATCH_WEIGHTS = Object.freeze({
  affinityBps: 5_000,
  availabilityBps: 2_500,
  fairnessBps: 1_500,
  acceptanceRateBps: 1_000,
  totalBps: 10_000,
} as const);

export const MATCH_PENALTIES = Object.freeze({
  /** Per patient already routed to this professional in the current window. */
  currentWorkloadPerPatientBps: 300,
  /** Applied when the professional's historical delay risk is high. */
  delayRiskBps: 800,
} as const);

/** Neutral affinity for a (professional, condition) pair never seen before. */
export const AFFINITY = Object.freeze({
  priorScore: 0.5,
  /** Exponential-moving-average factor when folding a new consulta outcome in. */
  learningRate: 0.2,
  min: 0,
  max: 1,
} as const);

/** Score below which no professional is considered a viable match. */
export const MATCH_VIABILITY_THRESHOLD = 0.15;

export const SAGA = Object.freeze({
  slotReservationMaxAttempts: 3,
  slotReservationRetryDelayMs: 250,
} as const);
