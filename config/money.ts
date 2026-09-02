/**
 * Money as code. No bare numeric currency values are allowed anywhere else in
 * the system — every price, fee or quota cost is declared here once, in minor
 * units (centavos), and referenced by name.
 */

export const CURRENCY = Object.freeze({
  code: "BRL",
  minorUnitsPerMajor: 100,
  symbol: "R$",
} as const);

export type CurrencyCode = typeof CURRENCY.code;

/** An amount in minor units (centavos). Branded so it can't be mixed with plain numbers. */
export type Money = number & { readonly __brand: "Money.BRL.centavos" };

export const money = (centavos: number): Money => {
  if (!Number.isInteger(centavos) || centavos < 0) {
    throw new RangeError(`Money must be a non-negative integer of centavos, got ${centavos}`);
  }
  return centavos as Money;
};

/** Build Money from a major-unit (reais) literal declared in this file only. */
const reais = (value: number): Money => money(Math.round(value * CURRENCY.minorUnitsPerMajor));

export const formatMoney = (amount: Money): string =>
  `${CURRENCY.symbol}${(amount / CURRENCY.minorUnitsPerMajor).toFixed(2)}`;

/**
 * Pay-as-you-go price book — the "Valores (pacotes individuais)" section of
 * docs/prompts/00.md. `ZERO` is used explicitly so "free" is a decision, not an
 * accidental missing entry.
 */
export const ZERO: Money = money(0);

export const PRICE_BOOK = Object.freeze({
  /** Consulta base — receita principal. */
  consultaBase: reais(100),
  /** Mensalidade fixa — não existe. */
  monthlySubscription: ZERO,
  /** Agente Assistente (texto) — incluído no plano grátis. */
  assistantAgentText: ZERO,
  /** Transcrição de áudio (Whisper Large v3 Turbo via Groq). */
  audioTranscriptionPerMinute: reais(0.01),
  /** Conta individual ElevenLabs (voz clonada) — Starter. */
  elevenLabsAccountMonthly: reais(30),
  /** Análise emocional por vídeo em tempo real. */
  videoEmotionAnalysisPerConsulta: reais(5),
  /** Contabilidade — Impostos. */
  accountingTaxesMonthly: reais(50),
  /** Contabilidade preditiva / financeiro preditivo. */
  predictiveAccountingMonthly: ZERO,
  predictiveFinanceMonthly: ZERO,
  /** Add-on áudio do Agente na Camada 1 (100 min + análise de emoção). */
  camada1AudioAddonMonthly: reais(10),
  /** Add-on Camada 3 (30 min transcrição + 30 min voz clonada). */
  camada3AudioAddonMonthly: reais(30),
} as const);

export type PriceName = keyof typeof PRICE_BOOK;

/** Revenue split for a consulta — "80% profissional / 20% plataforma". */
export const CONSULTA_REVENUE_SPLIT = Object.freeze({
  professionalBps: 8_000,
  platformBps: 2_000,
  totalBps: 10_000,
} as const);

export const splitConsulta = (gross: Money) => ({
  professional: money(Math.round((gross * CONSULTA_REVENUE_SPLIT.professionalBps) / CONSULTA_REVENUE_SPLIT.totalBps)),
  platform: money(Math.round((gross * CONSULTA_REVENUE_SPLIT.platformBps) / CONSULTA_REVENUE_SPLIT.totalBps)),
});
