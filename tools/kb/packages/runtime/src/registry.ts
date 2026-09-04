import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  type ActionDefinition,
  type ActionEffectHandler,
  type ActionHandlerEnv,
  type ActionInvocation,
  type ActionReceipt,
  actionToManifestEntry,
  failed,
  succeeded,
  type KbContext,
  type TemplateFn,
  type ExtensionFailure,
  type ExtensionPromiseHandler,
  type LoadedExtension,
} from "@kb/contracts";
import {
  ActionSchemaError,
  FailureCodeSchema,
  ResolveError,
  ensureDomainError,
  isDomainError,
  isZodError,
  parseActionInput,
  receiptCodeOf,
  type DomainError,
} from "@kb/model";
import {
  discoverExtensions,
  namespacedId,
  assetUploadDef,
  assetUploadEffect,
  fieldDefineDef,
  fieldDefineEffect,
  graphQueryDef,
  graphQueryEffect,
  graphRunDef,
  graphRunEffect,
  graphSearchDef,
  graphSearchEffect,
  nodeAddDef,
  nodeAddEffect,
  nodeGetDef,
  nodeGetEffect,
  nodeUpdateDef,
  nodeUpdateEffect,
  tagDefineDef,
  tagDefineEffect,
  ontologyMembersDef,
  ontologyMembersEffect,
  renderViewActionEffect,
  renderViewDef,
  renderViewsActionEffect,
  renderViewsDef,
} from "@kb/operations";
import { writeErr } from "./output.ts";
import { docsActions, docsTemplates } from "@kb/ext-docs";
import { canvasActions } from "@kb/ext-canvas";

/** Services Effect-native handlers may require; provided at the invoke tip. */
export type { ActionHandlerEnv } from "@kb/contracts";

export interface RegisteredAction {
  def: ActionDefinition;
  /**
   * Effect-native handler. Preferred when set — composed directly inside
   * {@link invokeEffect} (no `tryPromise`).
   */
  effect?: ActionEffectHandler;
  /**
   * Legacy Promise handler. Used only when {@link RegisteredAction.effect}
   * is absent (third-party `.kb/extensions`).
   */
  handler?: ExtensionPromiseHandler;
  /** "core" | "ext:<name>" */
  source: string;
  aliases: readonly string[];
}

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

function coreNative(def: ActionDefinition, effect: ActionEffectHandler): RegisteredAction {
  return { def, effect, source: "core", aliases: [] };
}

const CORE_ACTIONS: readonly RegisteredAction[] = [
  coreNative(nodeAddDef, nodeAddEffect),
  coreNative(nodeUpdateDef, nodeUpdateEffect),
  coreNative(nodeGetDef, nodeGetEffect),
  coreNative(fieldDefineDef, fieldDefineEffect),
  coreNative(tagDefineDef, tagDefineEffect),
  coreNative(graphQueryDef, graphQueryEffect),
  coreNative(graphRunDef, graphRunEffect),
  coreNative(graphSearchDef, graphSearchEffect),
  coreNative(assetUploadDef, assetUploadEffect),
  coreNative(renderViewDef, renderViewActionEffect),
  coreNative(renderViewsDef, renderViewsActionEffect),
  coreNative(ontologyMembersDef, ontologyMembersEffect),
];

/** Extensions shipped with kb itself; loaded like repo extensions. */
const BUNDLED_EXTENSIONS: readonly LoadedExtension[] = [
  { name: "docs", source: "bundled", actions: docsActions, templates: docsTemplates },
  { name: "canvas", source: "bundled", actions: canvasActions, templates: [] },
];

const buildRegistry = Effect.fnUntraced(function* (
  root: string | null,
): Effect.fn.Return<Registry, never, FileSystem> {
  const actions: RegisteredAction[] = [...CORE_ACTIONS];
  const byId = new Map<string, RegisteredAction>();
  for (const action of CORE_ACTIONS) byId.set(action.def.id, action);

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
export function isEffectNativeAction(action: RegisteredAction): boolean {
  return typeof action.effect === "function";
}

function mapHandlerError(err: unknown): ActionSchemaError | DomainError {
  if (err instanceof ActionSchemaError) return err;
  return ensureDomainError(err);
}

/**
 * Effect invoke — failures stay typed until {@link invoke} maps them to receipts.
 * Native handlers are composed directly (scoped); legacy Promise handlers are
 * the only path that uses `tryPromise`.
 */
export const invokeEffect = Effect.fn("kb.invoke")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, ActionSchemaError | DomainError, ActionHandlerEnv> {
  const { id, input } = invocation;
  // Registry discovery still uses dynamic import (external boundary).
  const registry = yield* registryFor(ctx.root);
  const entry = registry.byId.get(id);
  if (!entry) return failed(id, "unknown_action", `unknown action: ${id}`);

  const parsed = yield* parseActionInput(entry.def.inputSchema, input);

  if (entry.effect) {
    const output = yield* Effect.scoped(entry.effect(parsed as never)).pipe(
      Effect.mapError(mapHandlerError),
    );
    return succeeded(id, output);
  }

  const handler = entry.handler;
  if (handler) {
    const output = yield* Effect.tryPromise({
      try: () => handler(ctx, parsed as never),
      catch: mapHandlerError,
    });
    return succeeded(id, output);
  }

  return failed(id, "internal", `action has no effect or handler: ${id}`);
});

/**
 * Effect invoke that always succeeds with an {@link ActionReceipt}.
 * Surfaces compose this inside Effect programs; typed failures from
 * {@link invokeEffect} are mapped through the canonical receipt mapper.
 * Requires {@link ActionHandlerEnv} so native handlers receive Layers.
 */
export const invokeReceiptEffect = Effect.fn("kb.invokeReceipt")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, never, ActionHandlerEnv> {
  return yield* invokeEffect(ctx, invocation).pipe(
    Effect.catch((err) => Effect.succeed(receiptFromError(invocation.id, err))),
  );
});

export function receiptFromError(id: string, err: unknown): ActionReceipt {
  if (err instanceof ActionSchemaError) {
    return failed(id, "invalid_input", err.message, err.issues);
  }
  if (isZodError(err)) {
    return failed(id, "invalid_input", err.message, err.issues);
  }
  if (isDomainError(err)) {
    return failed(id, receiptCodeOf(err), err.message, err.details);
  }
  if (err instanceof ResolveError) {
    return failed(id, receiptCodeOf(err), err.message, err.details);
  }
  if (err instanceof Error) {
    // DocsError and extension errors alike: any Error carrying a valid
    // FailureCode `code` maps to a typed failure.
    const parsed = FailureCodeSchema.safeParse((err as { code?: unknown }).code);
    if (parsed.success) {
      return failed(id, parsed.data, err.message, (err as { details?: unknown }).details);
    }
    return failed(id, "internal", err.message);
  }
  return failed(id, "internal", String(err));
}
