/**
 * Semantic identities as code (AGENTS.md §4, §5, §21).
 *
 * Every Agent, AtomicBehaviour and Context has a canonical label declared here.
 * Nothing in the system names an actor with a bare string literal.
 */

export const AGENT = Object.freeze({
  intake: "agent.intake",
  triage: "agent.triage",
  governance: "agent.governance",
  matching: "agent.matching",
  scheduling: "agent.scheduling",
  queue: "agent.queue",
  notification: "agent.notification",
  audit: "agent.audit",
} as const);
export type AgentLabel = (typeof AGENT)[keyof typeof AGENT];

export const CONTEXT_LABEL = Object.freeze({
  intake: "context.Intake",
  triage: "context.Triage",
  governance: "context.Governance",
  matching: "context.Matching",
  scheduling: "context.Scheduling",
  queue: "context.Queue",
  notification: "context.Notification",
  audit: "context.Audit",
} as const);
export type ContextLabel = (typeof CONTEXT_LABEL)[keyof typeof CONTEXT_LABEL];

/**
 * Canonical AtomicBehaviour labels. Form: `<Entity>.<verb>` or
 * `<Entity>.<attr>.<predicate>` — an unqualified verb is never a valid
 * executable identity (AGENTS.md §6).
 */
export const BEHAVIOR = Object.freeze({
  classifyComplaint: "Complaint.classify",
  scoreAffinity: "Professional.affinity.score",
  rankCandidates: "Candidate.rank.topK",
  assignQueuePosition: "QueueEntry.position.assign",
  reserveSlot: "Slot.reserve",
  releaseSlot: "Slot.release",
  requestHumanApproval: "Governance.approval.request",
  upsertProjection: "Projection.record.upsert",
  dispatchWhatsapp: "Whatsapp.message.dispatch",
  transcribeAudio: "Audio.transcribe",
} as const);
export type BehaviorLabel = (typeof BEHAVIOR)[keyof typeof BEHAVIOR];

export const INVOCATION_POLICY = Object.freeze({
  open: "open",
  restricted: "restricted",
} as const);
export type InvocationPolicy = (typeof INVOCATION_POLICY)[keyof typeof INVOCATION_POLICY];
