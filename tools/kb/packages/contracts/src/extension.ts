import type { KbContext } from "./session.ts";
import type { ActionDefinition, ActionEffectHandler } from "./actions.ts";

/**
 * Extension contract: what a TS module in `.kb/extensions/` (repo-local =
 * trusted) default-exports — an `ActionDefinition` plus either an Effect
 * `effect` handler (preferred) or a legacy Promise `handler`.
 *
 * Types only. The loader that discovers, imports and validates such modules
 * is application behaviour and lives with the operations layer.
 */
export type ExtensionPromiseHandler = (ctx: KbContext, input: never) => Promise<unknown>;

export type ExtensionAction = ActionDefinition & {
  /** Extra top-level ids this action also answers to (compat shims). */
  aliases?: readonly string[];
} & (
    | {
        effect: ActionEffectHandler;
        handler?: ExtensionPromiseHandler;
      }
    | {
        handler: ExtensionPromiseHandler;
        effect?: ActionEffectHandler;
      }
  );

export interface LoadedExtension {
  /** File basename without `.ts`; becomes the `ext.<name>.` namespace. */
  name: string;
  /** "bundled" or the absolute path of the source module. */
  source: string;
  /** Actions as authored (ids still local, un-namespaced). */
  actions: readonly ExtensionAction[];
}

export interface ExtensionFailure {
  file: string;
  error: string;
}
