/** The agent society for the consulta-scheduling flow. */

import type { Agent } from "./agent.js";
import { intakeAgent } from "./intake-agent.js";
import { triageAgent } from "./triage-agent.js";
import { governanceAgent } from "./governance-agent.js";
import { orchestratorAgent } from "./orchestrator-agent.js";
import { matchingAgent } from "./matching-agent.js";
import { queueAgent } from "./queue-agent.js";
import { schedulingAgent } from "./scheduling-agent.js";
import { notificationAgent } from "./notification-agent.js";
import { auditAgent } from "./audit-agent.js";
import { transcriptionAgent } from "./transcription-agent.js";
import { voiceAgent } from "./voice-agent.js";
import { calendarMirrorAgent } from "./calendar-mirror-agent.js";

export { AgentRuntime, type RuntimeDeps } from "./runtime.js";
export { type Agent, type AgentHandlerCtx, type AgentSubscription } from "./agent.js";

export const ALL_AGENTS: readonly Agent[] = Object.freeze([
  intakeAgent,
  triageAgent,
  governanceAgent,
  orchestratorAgent,
  matchingAgent,
  queueAgent,
  schedulingAgent,
  notificationAgent,
  auditAgent,
  transcriptionAgent,
  voiceAgent,
  calendarMirrorAgent,
]);

export {
  intakeAgent,
  triageAgent,
  governanceAgent,
  orchestratorAgent,
  matchingAgent,
  queueAgent,
  schedulingAgent,
  notificationAgent,
  auditAgent,
  transcriptionAgent,
  voiceAgent,
  calendarMirrorAgent,
};
