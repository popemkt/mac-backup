import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  type ActionDefinition,
  type ActionHandlerEnv,
  type ActionInvocation,
  type ActionReceipt,
  actionToManifestEntry,
  type KbContext,
  type TemplateFn,
  type ExtensionFailure,
  type LoadedExtension,
} from "@kb/contracts";
import type { ActionSchemaError, DomainError } from "@kb/model";
import { coreActions, invokeReceiptWith, invokeWith, type RegisteredAction } from "@kb/operations";
import { discoverExtensions, namespacedId } from "./extension-loader.ts";
import { writeErr } from "./output.ts";
import { docsActions, docsTemplates } from "@kb/ext-docs";
import { canvasActions } from "@kb/ext-canvas";

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
  actions: readonly RegisteredAction[];
  byId: ReadonlyMap<string, RegisteredAction>;
  /** Render templates by namespaced id and by alias; fed to the TemplateRegistry service. */
  templates: ReadonlyMap<string, TemplateFn>;
  extensions: readonly RegistryExtension[];
  failures: readonly ExtensionFailure[];
  manifestEntries: readonly ManifestEntry[];
}

const BUNDLED_EXTENSIONS: readonly LoadedExtension[] = [
  { name: "docs", source: "bundled", actions: docsActions, templates: docsTemplates },
  { name: "canvas", source: "bundled", actions: canvasActions, templates: [] },
];

const buildRegistry = Effect.fnUntraced(function* (
  root: string | null,
): Effect.fn.Return<Registry, never, FileSystem> {
  const actions: RegisteredAction[] = [...coreActions];
  const byId = new Map<string, RegisteredAction>();
  for (const action of coreActions) byId.set(action.def.id, action);

  const templatesById = new Map<string, TemplateFn>();

  const extensions: RegistryExtension[] = [];
  const failures: ExtensionFailure[] = [];

  const register = (ext: LoadedExtension): void => {
    const registered: RegisteredAction[] = [];
    const registeredTemplates: RegisteredTemplate[] = [];
    for (const action of ext.actions) {
      const id = namespacedId(ext.name, action.id);
      const aliases = action.aliases ?? [];
      const clash = [id, ...aliases].find((candidate) => byId.has(candidate));
      if (clash !== undefined) {
        failures.push({
          file: ext.source,
          error: `action id already registered: ${clash}`,
        });
        continue;
      }
      const entry: RegisteredAction = {
        def: {
          id,
          title: action.title,
          description: action.description,
          mode: action.mode,
          inputSchema: action.inputSchema,
          outputSchema: action.outputSchema,
        },
        effect: action.effect,
        handler: action.handler,
        source: `ext:${ext.name}`,
        aliases,
      };
      actions.push(entry);
      byId.set(id, entry);
      for (const alias of aliases) byId.set(alias, entry);
      registered.push(entry);
    }
    for (const template of ext.templates) {
      const id = namespacedId(ext.name, template.id);
      const aliases = template.aliases ?? [];
      const clash = [id, ...aliases].find((candidate) => templatesById.has(candidate));
      if (clash !== undefined) {
        failures.push({
          file: ext.source,
          error: `template id already registered: ${clash}`,
        });
        continue;
      }
      const entry: RegisteredTemplate = {
        id,
        template: template.template,
        source: `ext:${ext.name}`,
        aliases,
      };
      templatesById.set(id, template.template);
      for (const alias of aliases) templatesById.set(alias, template.template);
      registeredTemplates.push(entry);
    }
    extensions.push({
      name: ext.name,
      source: ext.source,
      actions: registered,
      templates: registeredTemplates,
    });
  };

  for (const ext of BUNDLED_EXTENSIONS) register(ext);

  if (root !== null) {
    const discovered = yield* discoverExtensions(root);
    failures.push(...discovered.failures);
    for (const ext of discovered.extensions) register(ext);
  }

  for (const failure of failures) {
    writeErr(`kb: extension ${failure.file}: ${failure.error} (skipped)`);
  }

  const manifestEntries: ManifestEntry[] = actions.flatMap((action) => [
    actionToManifestEntry(action.def),
    ...action.aliases.map((alias) => ({
      ...actionToManifestEntry(action.def),
      id: alias,
      aliasOf: action.def.id,
    })),
  ]);

  return { actions, byId, templates: templatesById, extensions, failures, manifestEntries };
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
