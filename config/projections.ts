/**
 * Projection & resource-pool namespace names as code.
 *
 * Projections are derived read models (AGENTS.md §17). Every KV namespace the
 * behaviours touch is named here — no namespace string literal elsewhere.
 */

export const PROJECTION = Object.freeze({
  /** The intake record (patient contact + complaint), read by downstream nodes. */
  intake: "intake-record",
  /** Per-professional ordered queue of waiting patients. */
  queue: "queue",
  /** Ordered-list namespace backing the fair positioner. */
  queueStream: "queue-stream",
  /** Scheduled consultas by patient. */
  consulta: "consulta",
  /** Learned (professional, condition) -> competence. */
  affinity: "professional-affinity",
  /** Optimistic-lock namespace for bookable slots. */
  slotPool: "slot-pool",
  /** Finalized transcripts by audio ref (raw + corrected + provenance). */
  transcript: "transcript",
  /** Open clarification requests raised by the response guard. */
  clarification: "clarification",
  /** Synthesized-speech artifacts by consulta / message ref. */
  speech: "speech",
  /** Google Calendar mirror state keyed by our consultaId. */
  calendarMirror: "calendar-mirror",
  /** External calendar events observed on the professional's own calendar. */
  externalCalendar: "external-calendar",
} as const);

export type ProjectionName = (typeof PROJECTION)[keyof typeof PROJECTION];
