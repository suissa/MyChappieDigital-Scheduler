/**
 * Behaviour registry — every generic AtomicBehaviour, keyed by canonical label.
 *
 * The flow-graph loader resolves node references against this map; the Tool
 * factory instantiates from it. Registration is explicit and static.
 */

import type { AtomicBehavior } from "./kind.js";
import { BEHAVIOR } from "../../config/identity.js";

import { classifyText } from "./actions/classify-text/index.js";
import { scoreWeighted } from "./actions/score-weighted/index.js";
import { selectTopK } from "./actions/select-top-k/index.js";
import { assignSequencePosition } from "./actions/assign-sequence-position/index.js";
import { reserveResource } from "./actions/reserve-resource/index.js";
import { releaseResource } from "./actions/release-resource/index.js";
import { requestHumanApproval } from "./actions/request-human-approval/index.js";
import { recordProjection } from "./actions/record-projection/index.js";
import { dispatchNotification } from "./actions/dispatch-notification/index.js";
import { transcribeAudio } from "./actions/transcribe-audio/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBehavior = AtomicBehavior<any, any, any>;

export const BEHAVIOR_REGISTRY: Readonly<Record<string, AnyBehavior>> = Object.freeze({
  [BEHAVIOR.classifyComplaint]: classifyText,
  [BEHAVIOR.scoreAffinity]: scoreWeighted,
  [BEHAVIOR.rankCandidates]: selectTopK,
  [BEHAVIOR.assignQueuePosition]: assignSequencePosition,
  [BEHAVIOR.reserveSlot]: reserveResource,
  [BEHAVIOR.releaseSlot]: releaseResource,
  [BEHAVIOR.requestHumanApproval]: requestHumanApproval,
  [BEHAVIOR.upsertProjection]: recordProjection,
  [BEHAVIOR.dispatchWhatsapp]: dispatchNotification,
  [BEHAVIOR.transcribeAudio]: transcribeAudio,
});

export const getBehavior = (label: string): AnyBehavior => {
  const b = BEHAVIOR_REGISTRY[label];
  if (!b) throw new Error(`unknown behaviour: ${label}`);
  return b;
};

export const allBehaviorManifests = () =>
  Object.values(BEHAVIOR_REGISTRY).map((b) => b.manifest);
