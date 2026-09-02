/**
 * Subject catalog as code.
 *
 * Every NATS subject the system ever publishes to or subscribes from is
 * declared here. No subject string literal is allowed outside this file.
 *
 * Grammar:  openmental.<context>.<aggregate>.<kind>.<version>
 *   kind = "event"   -> an immutable fact that already happened
 *   kind = "command" -> a request for something to happen (may be refused)
 *
 * Wildcards (NATS):  "*" = one token,  ">" = the rest of the subject.
 */

export const ROOT = "openmental" as const;
export const VERSION = "v1" as const;

export const CONTEXT = Object.freeze({
  intake: "intake",
  triage: "triage",
  matching: "matching",
  scheduling: "scheduling",
  queue: "queue",
  notification: "notification",
  governance: "governance",
  audit: "audit",
  behavior: "behavior",
} as const);
export type ContextName = (typeof CONTEXT)[keyof typeof CONTEXT];

export const KIND = Object.freeze({ event: "event", command: "command" } as const);
export type SubjectKind = (typeof KIND)[keyof typeof KIND];

const s = <C extends ContextName, A extends string, N extends string, K extends SubjectKind>(
  context: C,
  aggregate: A,
  name: N,
  kind: K,
): `${typeof ROOT}.${C}.${A}.${N}.${K}.${typeof VERSION}` =>
  [ROOT, context, aggregate, name, kind, VERSION].join(".") as `${typeof ROOT}.${C}.${A}.${N}.${K}.${typeof VERSION}`;

export const SUBJECTS = Object.freeze({
  // ---- intake -----------------------------------------------------------
  intakeSubmitted: s(CONTEXT.intake, "intake", "submitted", KIND.event),
  audioAttached: s(CONTEXT.intake, "intake", "audio-attached", KIND.event),

  // ---- triage ---------------------------------------------------------
  triageRequested: s(CONTEXT.triage, "triage", "requested", KIND.command),
  triageCompleted: s(CONTEXT.triage, "triage", "completed", KIND.event),
  crisisDetected: s(CONTEXT.triage, "triage", "crisis-detected", KIND.event),

  // ---- governance (human-in-the-loop) --------------------------------
  clinicalReviewRequested: s(CONTEXT.governance, "clinical-review", "requested", KIND.command),
  clinicalReviewResolved: s(CONTEXT.governance, "clinical-review", "resolved", KIND.event),

  // ---- matching -----------------------------------------------------
  matchingRequested: s(CONTEXT.matching, "match", "requested", KIND.command),
  professionalMatched: s(CONTEXT.matching, "match", "professional-matched", KIND.event),
  matchingFailed: s(CONTEXT.matching, "match", "failed", KIND.event),

  // ---- queue ------------------------------------------------------
  queuePositionAssigned: s(CONTEXT.queue, "queue-entry", "position-assigned", KIND.event),
  queueProjectionUpdated: s(CONTEXT.queue, "queue-projection", "updated", KIND.event),

  // ---- scheduling -----------------------------------------------
  slotReservationRequested: s(CONTEXT.scheduling, "slot", "reservation-requested", KIND.command),
  consultaScheduled: s(CONTEXT.scheduling, "consulta", "scheduled", KIND.event),
  slotReservationFailed: s(CONTEXT.scheduling, "slot", "reservation-failed", KIND.event),
  slotHoldReleased: s(CONTEXT.scheduling, "slot", "hold-released", KIND.event),

  // ---- notification -------------------------------------------
  whatsappDispatchRequested: s(CONTEXT.notification, "whatsapp", "dispatch-requested", KIND.command),
  whatsappDispatched: s(CONTEXT.notification, "whatsapp", "dispatched", KIND.event),

  // ---- projections ----------------------------------------------
  affinityProjectionUpdated: s(CONTEXT.matching, "affinity-projection", "updated", KIND.event),
  consultaProjectionUpdated: s(CONTEXT.scheduling, "consulta-projection", "updated", KIND.event),
} as const);

export type SubjectName = keyof typeof SUBJECTS;
export type Subject = (typeof SUBJECTS)[SubjectName];

/** Subscription patterns (wildcards) — also declared as code, never inline. */
export const PATTERNS = Object.freeze({
  everything: [ROOT, ">"].join("."),
  allEvents: [ROOT, "*", "*", "*", KIND.event, VERSION].join("."),
  allCommands: [ROOT, "*", "*", "*", KIND.command, VERSION].join("."),
  context: (context: ContextName): string => [ROOT, context, ">"].join("."),
  behaviorReplies: [ROOT, CONTEXT.behavior, "*", "responded", KIND.event, VERSION].join("."),
} as const);

/** Behaviour request/response subjects, derived from a canonical behaviour label. */
export const behaviorSubject = Object.freeze({
  requested: (label: string): string =>
    [ROOT, CONTEXT.behavior, label, "requested", KIND.command, VERSION].join("."),
  responded: (label: string): string =>
    [ROOT, CONTEXT.behavior, label, "responded", KIND.event, VERSION].join("."),
} as const);

const KNOWN = new Set<string>(Object.values(SUBJECTS));
export const isKnownSubject = (subject: string): subject is Subject => KNOWN.has(subject);
