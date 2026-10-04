import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  ActionPoint,
  TemplatePoint,
  ViewKeyPoint,
  declarationPlugin,
  actionToManifestEntry,
  extensionPlugin,
  extensionRow,
  familyOn,
  NO_SWITCHES,
  type NodeLookup,
  type ActionContribution,
  type ActionHandlerEnv,
  type ActionInvocation,
  type ActionReceipt,
  type ExtensionEntry,
  type ExtensionFailure,
  type ExtensionRow,
  type KbContext,
  type ManifestEntry,
  type TemplateFn,
  type ViewDef,
} from "@kb/contracts";
import type { ActionSchemaError, DomainError } from "@kb/model";
import {
  coreActions,
  coreExtension,
  invokeReceiptWith,
  invokeWith,
  type RegisteredAction,
} from "@kb/operations";
import { viewCatalogOf, type ViewCatalogOf } from "@kb/views";
import { definePlugin, makeKernel, type Contribution, type Kernel, type Plugin } from "@kb/plugin";
import { BUNDLED_EXTENSIONS } from "./bundled.ts";
import { discoverExtensions } from "./extension-loader.ts";
import { writeErr } from "./output.ts";

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
  /** The views the loaded plugins contributed to `ViewKeyPoint`: what the `ViewCatalog` service holds. */
  views: ViewCatalogOf<ViewDef<unknown>>;
  /**
   * Every bundled family, loaded or not, then each repository extension that
   * loaded: what `kb.manifest` reports of this registry (`ExtensionCatalog`).
   */
  families: readonly ExtensionRow[];
}

/**
 * Core's server entry: its actions, contributed like anyone else's but in the
 * root namespace, and its declaration's views, loaded as a child.
 */
const corePlugin = definePlugin({
  name: coreExtension.name,
  namespace: "",
  apply: (ctx) =>
    Effect.all(
      [
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
        ctx.plugin(declarationPlugin(coreExtension)),
      ],
      { discard: true },
    ),
});

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
 * the store has on (`on`) and the repo's `.kb/extensions`, then derive every
 * table from the points they contributed to. A plugin that cannot load (a
 * clash, a throwing module) is reported and leaves nothing behind.
 */
const buildRegistry = Effect.fnUntraced(function* (
  root: string | null,
  on: readonly ExtensionEntry[],
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
  for (const { entry } of on) yield* load(entry, "bundled");
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

  const views = viewCatalogOf(kernel.contributions(ViewKeyPoint).map(({ value }) => value));

  // A repository extension declares nothing, so it reads as a declaration of its name alone.
  const families: ExtensionRow[] = [
    ...BUNDLED_EXTENSIONS.map(({ declaration }) =>
      extensionRow(declaration, "bundled", sources.get(declaration.name) === "bundled"),
    ),
    ...extensions
      .filter(({ source }) => source !== "bundled")
      .map(({ name, source }) => extensionRow({ name, label: name }, source, true)),
  ];

  return {
    kernel,
    actions,
    byId,
    templates,
    extensions,
    failures,
    manifestEntries,
    views,
    families,
  };
});

const registryCache = new Map<string, Effect.Effect<Registry, never, FileSystem>>();
const NO_ROOT_KEY = "no-root";

/**
 * Registry for a kb root: core actions + the bundled extensions its store
 * has on + `.kb/extensions/*.ts`. An optional family is on while the store
 * `nodeOf` reads says so (`familyOn`); with no store, every optional family
 * is off. Cached per root and per set of families on, for the process
 * lifetime (extension changes need a restart), so switching a family is a
 * new key, and switching it back finds the old registry. `null` root = core
 * + bundled only.
 */
export const registryFor = Effect.fn("kb.registryFor")(function* (
  root: string | null,
  nodeOf: NodeLookup = NO_SWITCHES,
): Effect.fn.Return<Registry, never, FileSystem> {
  const unread: string[] = [];
  const on = BUNDLED_EXTENSIONS.filter(({ declaration }) =>
    familyOn(declaration, nodeOf, (warning) => unread.push(`${declaration.name}: ${warning}`)),
  );
  const key = [root ?? NO_ROOT_KEY, ...on.map(({ declaration }) => declaration.name)].join("\0");
  let registry = registryCache.get(key);
  if (registry === undefined) {
    for (const warning of unread) writeErr(`kb: extension switch ${warning} (read as off)`);
    // `Effect.cached` is what makes the entry a build-once value rather than a
    // recipe: concurrent callers share the one in-flight build, as the cached
    // Promise did.
    registry = yield* Effect.cached(buildRegistry(root, on));
    registryCache.set(key, registry);
  }
  return yield* registry;
});

/** The registry a session runs in: its root's, as its own store switches the families. */
export function sessionRegistry(ctx: KbContext): Effect.Effect<Registry, never, FileSystem> {
  return registryFor(ctx.root, (id) => ctx.index.getNode(id));
}

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
 * `@kb/operations` (`invokeWith`); this binds it to the session's registry.
 */
export const invokeEffect = Effect.fn("kb.invoke")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, ActionSchemaError | DomainError, ActionHandlerEnv> {
  const registry = yield* sessionRegistry(ctx);
  return yield* invokeWith(registry.byId, ctx, invocation);
});

export const invokeReceiptEffect = Effect.fn("kb.invokeReceipt")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, never, ActionHandlerEnv> {
  const registry = yield* sessionRegistry(ctx);
  return yield* invokeReceiptWith(registry.byId, ctx, invocation);
});

export { receiptFromError, isEffectNativeAction } from "@kb/operations";
