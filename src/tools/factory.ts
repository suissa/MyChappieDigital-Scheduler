/** Instantiate a generic behaviour as a named Tool bound to a specific config. */

import type { AtomicBehavior } from "../behaviors/kind.js";
import { Tool } from "./tool.js";

export const instantiateTool = <TConfig, TInput, TOutput>(args: {
  name: string;
  owner: string;
  behavior: AtomicBehavior<TConfig, TInput, TOutput>;
  config: TConfig;
}): Tool<TConfig, TInput, TOutput> =>
  new Tool({ name: args.name, owner: args.owner, behavior: args.behavior, config: args.config });
