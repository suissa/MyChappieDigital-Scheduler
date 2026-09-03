/**
 * Everything-as-Code barrel.
 *
 * Rule enforced across the codebase: no bare literal that carries business
 * meaning (money, model id, subject, threshold, weight, quota, endpoint,
 * canonical label) may appear outside `config/`. Import it from here.
 */

export * as Money from "./money.js";
export * as Models from "./ai-models.js";
export * as Subjects from "./subjects.js";
export * as Clinical from "./clinical.js";
export * as Scheduling from "./scheduling.js";
export * as Broker from "./broker.js";
export * as Identity from "./identity.js";
export * as Plans from "./plans.js";
export * as Integrations from "./integrations.js";
export * as Projections from "./projections.js";
export * as SemanticTypes from "./semantic-types.js";
export * as Transcription from "./transcription.js";
export * as Speech from "./speech.js";
export * as Calendar from "./calendar.js";

export { SUBJECTS, PATTERNS, CONTEXT, behaviorSubject } from "./subjects.js";
export { AGENT, BEHAVIOR, CONTEXT_LABEL, INVOCATION_POLICY } from "./identity.js";
export { UBIQUIC, CONSUMER_GROUP } from "./broker.js";
export { PRICE_BOOK, formatMoney, money, ZERO, type Money as MoneyAmount } from "./money.js";
export { MODELS, type ModelKey } from "./ai-models.js";
export { CONDITION, ALL_CONDITIONS, URGENCY, type Condition, type UrgencyKey } from "./clinical.js";
