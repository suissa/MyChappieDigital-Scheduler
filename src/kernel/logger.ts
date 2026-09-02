/** Structured, correlation-aware logger (stderr; stdout stays clean for data). */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  child(bindings: Readonly<Record<string, unknown>>): Logger;
  debug(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  info(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  error(msg: string, fields?: Readonly<Record<string, unknown>>): void;
}

export const createLogger = (
  minLevel: LogLevel = "info",
  base: Readonly<Record<string, unknown>> = {},
): Logger => {
  const emit = (level: LogLevel, msg: string, fields?: Readonly<Record<string, unknown>>): void => {
    if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...base, ...fields });
    process.stderr.write(line + "\n");
  };
  return {
    child: (bindings) => createLogger(minLevel, { ...base, ...bindings }),
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
};
