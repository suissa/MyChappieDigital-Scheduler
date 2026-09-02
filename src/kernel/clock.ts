/** Injectable clock so flows and tests are deterministic. */

export interface Clock {
  now(): Date;
  nowMs(): number;
  nowIso(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};

export const fixedClock = (iso: string): Clock => {
  const at = new Date(iso);
  return {
    now: () => new Date(at),
    nowMs: () => at.getTime(),
    nowIso: () => at.toISOString(),
  };
};
