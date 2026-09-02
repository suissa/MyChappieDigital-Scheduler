/**
 * Clinical taxonomy as code.
 *
 * The condition vocabulary and urgency ladder that drive triage, professional
 * affinity and queue prioritisation (docs/prompts/00.md: "Se o profissional A
 * atende bem pacientes com ansiedade, o agente prioriza pacientes com ansiedade
 * para o profissional A").
 *
 * These are operational routing tags, not diagnoses.
 */

export const CONDITION = Object.freeze({
  ansiedade: "ansiedade",
  depressao: "depressao",
  panico: "panico",
  luto: "luto",
  estresse: "estresse",
  trauma: "trauma",
  relacionamento: "relacionamento",
  sono: "sono",
  autoestima: "autoestima",
  desconhecido: "desconhecido",
} as const);
export type Condition = (typeof CONDITION)[keyof typeof CONDITION];
export const ALL_CONDITIONS: readonly Condition[] = Object.freeze(Object.values(CONDITION));

/**
 * Deterministic keyword lexicon used by the (mock) triage classifier. The AI
 * model would replace this; the lexicon keeps the slice runnable and testable
 * without a model, and keeps the mapping auditable.
 */
export const CONDITION_LEXICON = Object.freeze({
  [CONDITION.ansiedade]: ["ansiedade", "ansioso", "ansiosa", "preocupacao", "nervoso", "aflito"],
  [CONDITION.depressao]: ["depressao", "triste", "tristeza", "sem vontade", "vazio", "desanimo"],
  [CONDITION.panico]: ["panico", "taquicardia", "falta de ar", "descontrole"],
  [CONDITION.luto]: ["luto", "perda", "faleceu", "morreu", "saudade"],
  [CONDITION.estresse]: ["estresse", "estressado", "sobrecarga", "exausto", "burnout"],
  [CONDITION.trauma]: ["trauma", "abuso", "assalto", "acidente", "flashback"],
  [CONDITION.relacionamento]: ["relacionamento", "casamento", "divorcio", "briga", "separacao"],
  [CONDITION.sono]: ["insonia", "sono", "pesadelo", "dormir"],
  [CONDITION.autoestima]: ["autoestima", "inseguranca", "autoimagem", "aparencia"],
} as const satisfies Record<Exclude<Condition, "desconhecido">, readonly string[]>);

export const URGENCY = Object.freeze({
  routine: { key: "routine", rank: 1, maxHoursToConsulta: 168 },
  elevated: { key: "elevated", rank: 2, maxHoursToConsulta: 72 },
  priority: { key: "priority", rank: 3, maxHoursToConsulta: 24 },
  crisis: { key: "crisis", rank: 4, maxHoursToConsulta: 2 },
} as const);
export type UrgencyKey = keyof typeof URGENCY;
export type UrgencyLevel = (typeof URGENCY)[UrgencyKey];

/** Phrases that force the `crisis` urgency and a human governance gate. */
export const CRISIS_LEXICON: readonly string[] = Object.freeze([
  "suicidio",
  "me matar",
  "nao aguento mais viver",
  "acabar com tudo",
  "me machucar",
  "automutilacao",
]);

export const URGENCY_KEYWORDS = Object.freeze({
  priority: ["urgente", "crise", "agora", "socorro", "emergencia"],
  elevated: ["logo", "essa semana", "piorando", "nao consigo trabalhar"],
} as const);

/** The urgency level that must route through `[?ClinicalReview]` before booking. */
export const HUMAN_GATE_URGENCY: UrgencyKey = "crisis";
