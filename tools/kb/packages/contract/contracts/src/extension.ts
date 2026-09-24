import { Effect } from "effect";
import { Point, definePlugin, type Plugin } from "@kb/plugin";
import type { KbContext } from "./session.ts";
import type { ActionDefinition, ActionEffectHandler } from "./actions.ts";
import type { ExtensionTemplate, TemplateFn } from "./template.ts";

/**
 * Extension contract: what a TS module in `.kb/extensions/` (repo-local =
 * trusted) default-exports — an array of contributions. A contribution is
 * either an action (an `ActionDefinition` plus an Effect `effect` handler,
 * preferred, or a legacy Promise `handler`) or a render template
 * ({@link ExtensionTemplate}). The registry namespaces both the same way:
 * `ext.<file>.<id>`, with optional bare-id aliases.
 *
 * Such an array is the declarative form of a plugin ({@link extensionPlugin});
 * the loader that discovers, imports and validates the modules lives with the
 * runtime.
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

/** One entry of an extension module's default-exported array. */
export type ExtensionContribution = ExtensionAction | ExtensionTemplate;

export interface LoadedExtension {
  /** File basename without `.ts`; becomes the `ext.<name>.` namespace. */
  name: string;
  /** "bundled" or the absolute path of the source module. */
  source: string;
  /** Actions as authored (ids still local, un-namespaced). */
  actions: readonly ExtensionAction[];
  /** Templates as authored (ids still local, un-namespaced). */
  templates: readonly ExtensionTemplate[];
}

export interface ExtensionFailure {
  file: string;
  error: string;
}

/**
 * An action as a plugin contributes it to {@link ActionPoint}. The id is the
 * contribution's (namespaced by the plugin), not a field of the value.
 */
export interface ActionContribution extends Omit<ActionDefinition, "id" | "effect"> {
  readonly effect?: ActionEffectHandler;
  readonly handler?: ExtensionPromiseHandler;
}

/** Every action any loaded plugin offers: core's, bundled extensions', the repo's. */
export const ActionPoint = Point<ActionContribution>()("kb.actions");

/** Every render template, by the id a view spec names it with. */
export const TemplatePoint = Point<TemplateFn>()("kb.templates");

/**
 * An extension's contributions, as the plugin that makes them — namespaced
 * `ext.<name>`, each action and template one contribution. The declarative
 * form (a default-exported array) and a bundled extension's lists both load
 * through this, so there is one way an extension enters the kernel.
 */
export function extensionPlugin(extension: {
  readonly name: string;
  readonly actions: readonly ExtensionAction[];
  readonly templates: readonly ExtensionTemplate[];
}): Plugin {
  return definePlugin({
    name: extension.name,
    namespace: `ext.${extension.name}`,
    apply: (ctx) =>
      Effect.all(
        [
          Effect.forEach(
            extension.actions,
            (action) =>
              ctx.contribute(ActionPoint, {
                id: action.id,
                aliases: action.aliases,
                value: action,
              }),
            { discard: true },
          ),
          Effect.forEach(
            extension.templates,
            (template) =>
              ctx.contribute(TemplatePoint, {
                id: template.id,
                aliases: template.aliases,
                value: template.template,
              }),
            { discard: true },
          ),
        ],
        { discard: true },
      ),
  });
}
