/** Branded identifiers + a dependency-free sortable id generator (ULID-ish). */

import { randomUUID } from "node:crypto";

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type CorrelationId = Brand<string, "CorrelationId">;
export type CausationId = Brand<string, "CausationId">;
export type EventId = Brand<string, "EventId">;
export type PatientId = Brand<string, "PatientId">;
export type ProfessionalId = Brand<string, "ProfessionalId">;
export type IntakeId = Brand<string, "IntakeId">;
export type ConsultaId = Brand<string, "ConsultaId">;
export type SlotId = Brand<string, "SlotId">;
export type QueueEntryId = Brand<string, "QueueEntryId">;
export type ReviewId = Brand<string, "ReviewId">;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Monotonic-ish, lexicographically sortable id: <48-bit time><random>. */
export const newId = <B extends string>(prefix: string): Brand<string, B> => {
  const now = Date.now();
  let ts = "";
  let n = now;
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[n % 32]! + ts;
    n = Math.floor(n / 32);
  }
  const rand = randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
  return `${prefix}_${ts}${rand}` as Brand<string, B>;
};

export const asCorrelationId = (v: string): CorrelationId => v as CorrelationId;
export const asCausationId = (v: string): CausationId => v as CausationId;

export const ID = Object.freeze({
  event: () => newId<"EventId">("evt"),
  correlation: () => newId<"CorrelationId">("cor"),
  patient: () => newId<"PatientId">("pat"),
  professional: () => newId<"ProfessionalId">("pro"),
  intake: () => newId<"IntakeId">("int"),
  consulta: () => newId<"ConsultaId">("con"),
  slot: () => newId<"SlotId">("slt"),
  queueEntry: () => newId<"QueueEntryId">("que"),
  review: () => newId<"ReviewId">("rev"),
} as const);
