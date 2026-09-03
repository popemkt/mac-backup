import { Effect } from "effect";
import { type FileSystem } from "effect/FileSystem";
import {
  type ActionDefinition,
  type ActionEffectHandler,
  type ActionInvocation,
  type ActionReceipt,
  actionToManifestEntry,
  failed,
  succeeded,
  KbCtx,
  KbStore,
  type KbContext,
  TemplateRegistry,
  type TemplateFn,
} from "@kb/contracts";
import { FailureCodeSchema } from "@kb/model";
import { ResolveError } from "@kb/model";
import {
  ActionSchemaError,
  parseActionInput,
  type ActionSchema,
  domainFromResolve,
  isDomainError,
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
import type {
  ExtensionAction,
  ExtensionFailure,
  ExtensionPromiseHandler,
  LoadedExtension,
} from "@kb/contracts";
import { docsActions, docsTemplates } from "@kb/ext-docs";
import { canvasActions } from "@kb/ext-canvas";

/** Services Effect-native handlers may require; provided at the invoke tip. */
export type ActionHandlerEnv = KbCtx | KbStore | FileSystem | TemplateRegistry;

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

export interface RegistryExtension {
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
  /** Render templates by namespaced id and by alias; fed to {@link TemplateRegistry}. */
  templates: ReadonlyMap<string, TemplateFn>;
  extensions: readonly RegistryExtension[];
  failures: readonly ExtensionFailure[];
  manifestEntries: readonly ManifestEntry[];
}

function coreNative(def: ActionDefinition, effect: ActionEffectHandler): RegisteredAction {
  return { def, effect, source: "core", aliases: [] };
}

const CORE_ACTIONS: readonly RegisteredAction[] = [
  coreNative(nodeAddDef, nodeAddEffect as ActionEffectHandler),
  coreNative(nodeUpdateDef, nodeUpdateEffect as ActionEffectHandler),
  coreNative(nodeGetDef, nodeGetEffect as ActionEffectHandler),
  coreNative(fieldDefineDef, fieldDefineEffect as ActionEffectHandler),
  coreNative(tagDefineDef, tagDefineEffect as ActionEffectHandler),
  coreNative(graphQueryDef, graphQueryEffect as ActionEffectHandler),
  coreNative(graphRunDef, graphRunEffect as ActionEffectHandler),
  coreNative(graphSearchDef, graphSearchEffect as ActionEffectHandler),
  coreNative(assetUploadDef, assetUploadEffect as ActionEffectHandler),
  coreNative(renderViewDef, renderViewActionEffect as ActionEffectHandler),
  coreNative(renderViewsDef, renderViewsActionEffect as ActionEffectHandler),
  coreNative(ontologyMembersDef, ontologyMembersEffect as ActionEffectHandler),
];

/** Extensions shipped with kb itself; loaded like repo extensions. */
const BUNDLED_EXTENSIONS: readonly LoadedExtension[] = [
  { name: "docs", source: "bundled", actions: docsActions, templates: docsTemplates },
  { name: "canvas", source: "bundled", actions: canvasActions, templates: [] },
];

async function buildRegistry(root: string | null): Promise<Registry> {
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
    const discovered = await discoverExtensions(root);
    failures.push(...discovered.failures);
    for (const ext of discovered.extensions) register(ext);
  }

  for (const failure of failures) {
    console.error(`kb: extension ${failure.file}: ${failure.error} (skipped)`);
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
}

const registryCache = new Map<string, Promise<Registry>>();
const NO_ROOT_KEY = "no-root";

/**
 * Registry for a kb root: core actions + bundled extensions +
 * `.kb/extensions/*.ts`. Cached per root for the process lifetime
 * (extension changes need a restart). `null` root = core + bundled only.
 */
export function registryFor(root: string | null): Promise<Registry> {
  const key = root ?? NO_ROOT_KEY;
  let registry = registryCache.get(key);
  if (!registry) {
    registry = buildRegistry(root);
    registryCache.set(key, registry);
  }
  return registry;
}

/** Test hook: drop cached registries so fresh roots re-discover extensions. */
export function resetRegistryCache(): void {
  registryCache.clear();
}

export async function manifest(root?: string): Promise<readonly ManifestEntry[]> {
  return (await registryFor(root ?? null)).manifestEntries;
}

export async function listDefinitions(root?: string): Promise<readonly ActionDefinition[]> {
  return (await registryFor(root ?? null)).actions.map((a) => a.def);
}

/** True when the registered action dispatches through an Effect handler. */
export function isEffectNativeAction(action: RegisteredAction): boolean {
  return typeof action.effect === "function";
}

const parseInputEffect = Effect.fn("kb.parseActionInput")(function* (
  schema: ActionSchema,
  input: unknown,
): Effect.fn.Return<unknown, ActionSchemaError | DomainError> {
  return yield* Effect.tryPromise({
    try: () => parseActionInput(schema, input),
    catch: (err) => {
      if (err instanceof ActionSchemaError) return err;
      if (isZodError(err)) {
        return new ActionSchemaError(err.message, [{ message: err.message }]);
      }
      if (err instanceof ResolveError) return domainFromResolve(err);
      if (isDomainError(err)) return err;
      return new ActionSchemaError(err instanceof Error ? err.message : String(err), [
        { message: err instanceof Error ? err.message : String(err) },
      ]);
    },
  });
});

function mapHandlerError(err: unknown): ActionSchemaError | DomainError | Error {
  if (err instanceof ResolveError) return domainFromResolve(err);
  if (isDomainError(err)) return err;
  if (err instanceof ActionSchemaError) return err;
  if (err instanceof Error) return err;
  return new Error(String(err));
}

/**
 * Effect invoke — failures stay typed until {@link invoke} maps them to receipts.
 * Native handlers are composed directly (scoped); legacy Promise handlers are
 * the only path that uses `tryPromise`.
 */
export const invokeEffect = Effect.fn("kb.invoke")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, ActionSchemaError | DomainError | Error, ActionHandlerEnv> {
  const { id, input } = invocation;
  // Registry discovery still uses dynamic import (external boundary).
  const registry = yield* Effect.tryPromise({
    try: () => registryFor(ctx.root),
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  });
  const entry = registry.byId.get(id);
  if (!entry) return failed(id, "unknown_action", `unknown action: ${id}`);

  const parsed = yield* parseInputEffect(entry.def.inputSchema, input);

  if (entry.effect) {
    const output = yield* Effect.scoped(entry.effect(parsed as never)).pipe(
      Effect.mapError(mapHandlerError),
    );
    return succeeded(id, output);
  }

  if (entry.handler) {
    const output = yield* Effect.tryPromise({
      try: () => entry.handler!(ctx, parsed as never),
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

function isZodError(err: unknown): err is Error & { issues: unknown } {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError";
}

// Type-only reference keeps the public extension contract exported from
// one place; see extensions.ts for the module shape.
export type { ExtensionAction, ExtensionFailure };
