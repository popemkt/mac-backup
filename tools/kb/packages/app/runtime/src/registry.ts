import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  ActionPoint,
  TemplatePoint,
  actionToManifestEntry,
  extensionPlugin,
  type ActionContribution,
  type ActionDefinition,
  type ActionHandlerEnv,
  type ActionInvocation,
  type ActionReceipt,
  type ExtensionFailure,
  type KbContext,
  type TemplateFn,
} from "@kb/contracts";
import type { ActionSchemaError, DomainError } from "@kb/model";
import { coreActions, invokeReceiptWith, invokeWith, type RegisteredAction } from "@kb/operations";
import { definePlugin, makeKernel, type Contribution, type Kernel, type Plugin } from "@kb/plugin";
import { discoverExtensions } from "./extension-loader.ts";
import { writeErr } from "./output.ts";
import { docsPlugin } from "@kb/ext-docs";
import { canvasPlugin } from "@kb/ext-canvas";
import { checkPlugin } from "@kb/ext-check";

/** Services Effect-native handlers may require; provided at the invoke tip. */
export type { ActionHandlerEnv } from "@kb/contracts";

/** A render template as registered: namespaced id plus its compat aliases. */
export interface RegisteredTemplate {
  /** Namespaced `ext.<name>.<id>`. */
  id: string;
  template: TemplateFn;
  /** "ext:<name>" */
  source: string;
  aliases: readonly string[];
}

interface RegistryExtension {
  name: string;
  /** "bundled" or the source module path. */
  source: string;
  /** Registered actions; defs carry the namespaced `ext.<name>.<id>`. */
  actions: readonly RegisteredAction[];
  /** Registered templates; ids carry the namespaced `ext.<name>.<id>`. */
  templates: readonly RegisteredTemplate[];
}

export interface ManifestEntry {
  id: string;
  title: string;
  description: string;
  mode: ActionDefinition["mode"];
  inputSchema: unknown;
  outputSchema: unknown;
  /** Present when this id is a compat alias for another registered id. */
  aliasOf?: string;
}

export interface Registry {
  /** The kernel every action and template was loaded into. */
  kernel: Kernel;
  actions: readonly RegisteredAction[];
  byId: ReadonlyMap<string, RegisteredAction>;
  /** Render templates by namespaced id and by alias; fed to the TemplateRegistry service. */
  templates: ReadonlyMap<string, TemplateFn>;
  extensions: readonly RegistryExtension[];
  failures: readonly ExtensionFailure[];
  manifestEntries: readonly ManifestEntry[];
}

/** Core's actions, contributed like anyone else's but in the root namespace. */
const corePlugin = definePlugin({
  name: "core",
  namespace: "",
  apply: (ctx) =>
    Effect.forEach(
      coreActions,
      (action) =>
        ctx.contribute(ActionPoint, {
          id: action.def.id,
          aliases: action.aliases,
          value: { ...action.def, effect: action.effect, handler: action.handler },
        }),
      { discard: true },
    ),
});

const BUNDLED_PLUGINS: readonly Plugin[] = [docsPlugin, canvasPlugin, checkPlugin];

/** The top-level plugin a contribution belongs to (a child answers for its parent). */
function rootOwner(contribution: Contribution<unknown>): string {
  return contribution.owner.split("/")[0] ?? contribution.owner;
}

function sourceOf(contribution: Contribution<unknown>): string {
  const owner = rootOwner(contribution);
  return owner === corePlugin.name ? "core" : `ext:${owner}`;
}

function registeredAction(contribution: Contribution<ActionContribution>): RegisteredAction {
  const { value } = contribution;
  return {
    def: {
      id: contribution.id,
      title: value.title,
      description: value.description,
      mode: value.mode,
      inputSchema: value.inputSchema,
      outputSchema: value.outputSchema,
    },
    effect: value.effect,
    handler: value.handler,
    source: sourceOf(contribution),
    aliases: contribution.aliases,
  };
}

function registeredTemplate(contribution: Contribution<TemplateFn>): RegisteredTemplate {
  return {
    id: contribution.id,
    template: contribution.value,
    source: sourceOf(contribution),
    aliases: contribution.aliases,
  };
}

/**
 * The registry is a reading of the kernel: load core, the bundled extensions
 * and the repo's `.kb/extensions`, then derive every table from the points
 * they contributed to. A plugin that cannot load (a clash, a throwing module)
 * is reported and leaves nothing behind.
 */
const buildRegistry = Effect.fnUntraced(function* (
  root: string | null,
): Effect.fn.Return<Registry, never, FileSystem> {
  const kernel = makeKernel();
  const failures: ExtensionFailure[] = [];
  const sources = new Map<string, string>();

  const load = (plugin: Plugin, source: string): Effect.Effect<void> =>
    kernel.load(plugin).pipe(
      Effect.map(() => {
        sources.set(plugin.name, source);
      }),
      Effect.catchTag("Kb/PluginError", (error) =>
        Effect.sync(() => {
          failures.push({ file: source, error: error.message });
        }),
      ),
    );

  yield* load(corePlugin, "core");
  for (const plugin of BUNDLED_PLUGINS) yield* load(plugin, "bundled");
  if (root !== null) {
    const discovered = yield* discoverExtensions(root);
    failures.push(...discovered.failures);
    for (const extension of discovered.extensions) {
      yield* load(extensionPlugin(extension), extension.source);
    }
  }

  for (const failure of failures) {
    writeErr(`kb: extension ${failure.file}: ${failure.error} (skipped)`);
  }

  const actions = kernel.contributions(ActionPoint).map(registeredAction);
  const byId = new Map<string, RegisteredAction>();
  for (const action of actions) {
    byId.set(action.def.id, action);
    for (const alias of action.aliases) byId.set(alias, action);
  }
  const templateEntries = kernel.contributions(TemplatePoint).map(registeredTemplate);
  const templates = new Map<string, TemplateFn>();
  for (const template of templateEntries) {
    templates.set(template.id, template.template);
    for (const alias of template.aliases) templates.set(alias, template.template);
  }

  const extensions: RegistryExtension[] = [...sources]
    .filter(([name]) => name !== corePlugin.name)
    .map(([name, source]) => ({
      name,
      source,
      actions: actions.filter((action) => action.source === `ext:${name}`),
      templates: templateEntries.filter((template) => template.source === `ext:${name}`),
    }));

  const manifestEntries: ManifestEntry[] = actions.flatMap((action) => [
    actionToManifestEntry(action.def),
    ...action.aliases.map((alias) => ({
      ...actionToManifestEntry(action.def),
      id: alias,
      aliasOf: action.def.id,
    })),
  ]);

  return { kernel, actions, byId, templates, extensions, failures, manifestEntries };
});

const registryCache = new Map<string, Effect.Effect<Registry, never, FileSystem>>();
const NO_ROOT_KEY = "no-root";

/**
 * Registry for a kb root: core actions + bundled extensions +
 * `.kb/extensions/*.ts`. Cached per root for the process lifetime
 * (extension changes need a restart). `null` root = core + bundled only.
 */
export const registryFor = Effect.fn("kb.registryFor")(function* (
  root: string | null,
): Effect.fn.Return<Registry, never, FileSystem> {
  const key = root ?? NO_ROOT_KEY;
  let registry = registryCache.get(key);
  if (registry === undefined) {
    // `Effect.cached` is what makes the entry a build-once value rather than a
    // recipe: concurrent callers share the one in-flight build, as the cached
    // Promise did.
    registry = yield* Effect.cached(buildRegistry(root));
    registryCache.set(key, registry);
  }
  return yield* registry;
});

/** Test hook: drop cached registries so fresh roots re-discover extensions. */
export function resetRegistryCache(): void {
  registryCache.clear();
}

export const manifest = Effect.fn("kb.manifest")(function* (
  root?: string,
): Effect.fn.Return<readonly ManifestEntry[], never, FileSystem> {
  return (yield* registryFor(root ?? null)).manifestEntries;
});

/** True when the registered action dispatches through an Effect handler. */
/**
 * Invoke over the discovered registry. The invoke core lives in
 * `@kb/operations` (`invokeWith`); this binds it to `registryFor(ctx.root)`.
 */
export const invokeEffect = Effect.fn("kb.invoke")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, ActionSchemaError | DomainError, ActionHandlerEnv> {
  const registry = yield* registryFor(ctx.root);
  return yield* invokeWith(registry.byId, ctx, invocation);
});

export const invokeReceiptEffect = Effect.fn("kb.invokeReceipt")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, never, ActionHandlerEnv> {
  const registry = yield* registryFor(ctx.root);
  return yield* invokeReceiptWith(registry.byId, ctx, invocation);
});

export { receiptFromError, isEffectNativeAction } from "@kb/operations";
