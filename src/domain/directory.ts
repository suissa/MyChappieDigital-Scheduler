/**
 * Professional directory — the read model matching consults against.
 *
 * In production this is a projection folded from consulta-outcome events
 * (affinity learned via EMA, availability from the calendar). For the vertical
 * slice it is an in-memory store seeded from `seed.ts`; the shape and the port
 * are what the agents depend on.
 */

import type { Professional } from "./entities.js";
import type { Condition } from "../../config/clinical.js";
import { AFFINITY } from "../../config/scheduling.js";

export interface ProfessionalDirectory {
  list(): readonly Professional[];
  get(id: string): Professional | undefined;
  /** Fold a consulta outcome into the (professional, condition) affinity. */
  learn(id: string, condition: Condition, outcomeScore: number): number;
  /** Mark a slot as taken so a later match doesn't offer it again. */
  consumeSlot(id: string, slotIso: string): void;
  incrementLoad(id: string): void;
}

export class MemoryDirectory implements ProfessionalDirectory {
  readonly #byId = new Map<string, Professional>();

  constructor(seed: readonly Professional[]) {
    for (const p of seed) this.#byId.set(p.id, { ...p, affinity: { ...p.affinity }, openSlots: [...p.openSlots] });
  }

  list(): readonly Professional[] {
    return [...this.#byId.values()];
  }

  get(id: string): Professional | undefined {
    return this.#byId.get(id);
  }

  learn(id: string, condition: Condition, outcomeScore: number): number {
    const p = this.#byId.get(id);
    if (!p) return AFFINITY.priorScore;
    const prev = p.affinity[condition] ?? AFFINITY.priorScore;
    const next = clamp(prev + AFFINITY.learningRate * (outcomeScore - prev));
    this.#byId.set(id, { ...p, affinity: { ...p.affinity, [condition]: next } });
    return next;
  }

  consumeSlot(id: string, slotIso: string): void {
    const p = this.#byId.get(id);
    if (!p) return;
    this.#byId.set(id, { ...p, openSlots: p.openSlots.filter((s) => s !== slotIso) });
  }

  incrementLoad(id: string): void {
    const p = this.#byId.get(id);
    if (!p) return;
    this.#byId.set(id, { ...p, windowLoad: p.windowLoad + 1 });
  }
}

const clamp = (n: number): number => Math.max(AFFINITY.min, Math.min(AFFINITY.max, n));
