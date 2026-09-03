/**
 * AtomicBehaviour — the fundamental executable semantic unit (AGENTS.md §6-§12).
 *
 * A behaviour is *generic*: it declares a config schema, an input schema and an
 * output schema, plus a manifest with its canonical identity, its semantic
 * input/output type names (used by the flow-graph type checker) and its
 * invocation policy. An Agent turns a behaviour into a concrete `Tool` by
 * binding a specific config (see ../tools/tool.ts).
 */

import type { z } from "zod";
import type { Result } from "../kernel/result.js";
import type { Clock } from "../kernel/clock.js";
import type { Logger } from "../kernel/logger.js";
import type { InvocationPolicy } from "../../config/identity.js";

/** Generic capability ports handed to a behaviour. A behaviour never imports a
 *  concrete store, broker or HTTP client — it asks the sandbox for one. */
export interface KvPort {
  get<T>(namespace: string, key: string): Promise<T | undefined>;
  put<T>(namespace: string, key: string, value: T): Promise<void>;
  del(namespace: string, key: string): Promise<void>;
  list<T>(namespace: string): Promise<ReadonlyArray<readonly [string, T]>>;
}

export interface LockPort {
  /** Compare-and-set on a string token: succeeds only if the current holder
   *  equals `expected` (`undefined` = currently free). Passing `next = undefined`
   *  releases the lock. */
  compareAndSet(
    namespace: string,
    key: string,
    expected: string | undefined,
    next: string | undefined,
  ): Promise<boolean>;
}

export interface RequestPort {
  /** Issue a broker request/reply on `subject`, returning the response payload. */
  ask<TRes>(subject: string, payload: unknown, timeoutMs?: number): Promise<TRes>;
  /** Fire-and-forget publish of a domain fact. */
  emit(subject: string, payload: unknown): Promise<void>;
}

export interface HttpResponse {
  readonly status: number;
  readonly json: unknown;
  readonly text: string;
}

export interface HttpRequest {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface HttpPort {
  request(req: HttpRequest): Promise<HttpResponse>;
  /** Convenience for the common case. */
  postJson(url: string, body: unknown): Promise<{ status: number; json: unknown }>;
}

/**
 * An "AI provider" capability — a thin seam over the model gateways so a
 * behaviour can transcribe / complete / synthesize without importing an SDK.
 * Offline implementations return deterministic stand-ins.
 */
export interface AiPort {
  transcribe(req: {
    providerKey: string;
    audioRef: string;
    durationSeconds: number;
    language?: string;
    offlineTranscript?: string;
  }): Promise<{ text: string; costCentavos: number; modelId: string; simulated: boolean }>;

  complete(req: {
    modelId: string;
    prompt: string;
    temperature: number;
    live: boolean;
    /** Offline stand-in the caller supplies when `live` is false. */
    offlineCompletion?: string;
  }): Promise<{ text: string; tokensIn: number; tokensOut: number; simulated: boolean }>;

  synthesize(req: {
    modelId: string;
    text: string;
    voiceId: string;
    language: string;
    live: boolean;
  }): Promise<{ audioRef: string; characterCount: number; simulated: boolean }>;
}

export interface BehaviorContext {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly kv: KvPort;
  readonly locks: LockPort;
  readonly bus: RequestPort;
  readonly http: HttpPort;
  readonly ai: AiPort;
  /** Correlation identity threaded from the triggering event. */
  readonly correlationId: string;
}

export interface BehaviorManifest {
  readonly apiVersion: "openmental/v1";
  readonly kind: "AtomicBehavior";
  readonly canonicalLabel: string;
  readonly version: string;
  /** Semantic type names — the flow-graph checker compares these across edges. */
  readonly types: { readonly input: string; readonly output: string };
  readonly invocation: {
    readonly policy: InvocationPolicy;
    /** Canonical agent labels allowed to invoke, when policy = "restricted". */
    readonly allowedAgents: readonly string[];
    readonly humanInTheLoop: boolean;
  };
  readonly events: {
    readonly listen: readonly string[];
    readonly emit: readonly string[];
  };
  readonly execution: {
    readonly state: "stateless" | "stateful";
    readonly sandbox: boolean;
    readonly idempotent: boolean;
  };
}

export interface AtomicBehavior<TConfig, TInput, TOutput> {
  readonly manifest: BehaviorManifest;
  /** Schemas are declared with parse-output = the generic type; parse-input is
   *  intentionally `unknown` so `.default()`/`.optional()` fields are allowed. */
  readonly configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
  readonly inputSchema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  readonly outputSchema: z.ZodType<TOutput, z.ZodTypeDef, unknown>;
  execute(
    ctx: BehaviorContext,
    config: TConfig,
    input: TInput,
  ): Promise<Result<TOutput>>;
}

/** Helper for defining a behaviour with inferred generics. */
export const defineBehavior = <TConfig, TInput, TOutput>(
  b: AtomicBehavior<TConfig, TInput, TOutput>,
): AtomicBehavior<TConfig, TInput, TOutput> => b;
