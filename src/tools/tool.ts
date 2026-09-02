/**
 * Tool = a generic AtomicBehaviour + a bound config + an invocation policy,
 * instantiated for a specific Agent (AGENTS.md §9, §10).
 *
 * The Tool — not the Agent — governs its own invocation: `invoke` checks the
 * requesting actor against the behaviour manifest's policy before executing.
 * "An Agent does not acquire a Tool merely by declaring it."
 */

import { z } from "zod";
import type { AtomicBehavior, BehaviorContext } from "../behaviors/kind.js";
import { err, ok, domainError, type Result } from "../kernel/result.js";
import { INVOCATION_POLICY } from "../../config/identity.js";

export interface ToolDefinition<TConfig, TInput, TOutput> {
  /** Instance name the owning agent uses (e.g. "triage.classifier"). */
  readonly name: string;
  readonly behavior: AtomicBehavior<TConfig, TInput, TOutput>;
  readonly config: TConfig;
  /** Canonical label of the agent that owns this tool instance. */
  readonly owner: string;
}

export class Tool<TConfig, TInput, TOutput> {
  readonly name: string;
  readonly owner: string;
  readonly #behavior: AtomicBehavior<TConfig, TInput, TOutput>;
  readonly #config: TConfig;

  constructor(def: ToolDefinition<TConfig, TInput, TOutput>) {
    this.name = def.name;
    this.owner = def.owner;
    this.#behavior = def.behavior;
    // Fail fast: a mis-bound config is a build error, not a runtime surprise.
    this.#config = def.behavior.configSchema.parse(def.config);
  }

  get manifest() {
    return this.#behavior.manifest;
  }

  /** The target actor's own authorization decision (AGENTS.md §9 `B.Accepts(A)`). */
  accepts(invoker: string): boolean {
    const { policy, allowedAgents } = this.#behavior.manifest.invocation;
    if (policy === INVOCATION_POLICY.open) return true;
    return allowedAgents.includes(invoker);
  }

  async invoke(
    ctx: BehaviorContext,
    input: TInput,
    invoker: string,
  ): Promise<Result<TOutput>> {
    if (!this.accepts(invoker)) {
      return err(
        domainError("INVOCATION_DENIED", `${invoker} may not invoke ${this.manifest.canonicalLabel}`, {
          tool: this.name,
          policy: this.#behavior.manifest.invocation.policy,
        }),
      );
    }

    const parsedInput = this.#behavior.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      return err(
        domainError("INVALID_INPUT", "tool input failed schema validation", {
          tool: this.name,
          issues: parsedInput.error.issues,
        }),
      );
    }

    const result = await this.#behavior.execute(ctx, this.#config, parsedInput.data);
    if (!result.ok) return result;

    const parsedOutput = this.#behavior.outputSchema.safeParse(result.value);
    if (!parsedOutput.success) {
      return err(
        domainError("INVALID_OUTPUT", "tool output failed schema validation", {
          tool: this.name,
          issues: parsedOutput.error.issues,
        }),
      );
    }
    return ok(parsedOutput.data as TOutput);
  }
}

export const isZodType = (v: unknown): v is z.ZodTypeAny => v instanceof z.ZodType;
