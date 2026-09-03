import { Cause, Effect, Exit } from "effect";
import { FileSystem } from "effect/FileSystem";
import {
  type ActionDefinition,
  type ActionEffectHandler,
  type ActionInvocation,
  type ActionReceipt,
  actionToManifestEntry,
  failed,
  succeeded,
} from "./shared/contracts.ts";
import { FailureCodeSchema } from "./foundation/failure.ts";
import {
  KbCtx,
  KbStore,
  kbRuntimeLayer,
  type KbContext,
} from "./context.ts";
import { ResolveError } from "./foundation/resolve.ts";
import {
  ActionSchemaError,
  parseActionInput,
  type ActionSchema,
} from "./foundation/schema-seam.ts";
import {
  domainFromResolve,
  isDomainError,
  receiptCodeOf,
  type DomainError,
} from "./foundation/errors.ts";
import { discoverExtensions, namespacedId } from "./extensions.ts";
import type {
  ExtensionAction,
  ExtensionFailure,
  ExtensionPromiseHandler,
  LoadedExtension,
} from "./shared/extension.ts";
import bundledDocs from "../extensions-bundled/docs.ts";
import bundledCanvas from "../extensions-bundled/canvas.ts";
import {
  assetUploadDef,
  assetUploadEffect,
} from "./operations/assets.ts";
import {
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
} from "./operations/index.ts";
import {
  ontologyMembersDef,
  ontologyMembersEffect,
} from "./operations/ontology.ts";
import {
  renderViewActionEffect,
  renderViewDef,
  renderViewsActionEffect,
  renderViewsDef,
} from "./render/index.ts";

/** Services Effect-native handlers may require; provided at the invoke tip. */
export type ActionHandlerEnv = KbCtx | KbStore | FileSystem;

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

export interface RegistryExtension {
  name: string;
  /** "bundled" or the source module path. */
  source: string;
  /** Registered actions; defs carry the namespaced `ext.<name>.<id>`. */
  actions: readonly RegisteredAction[];
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
  extensions: readonly RegistryExtension[];
  failures: readonly ExtensionFailure[];
  manifestEntries: readonly ManifestEntry[];
}

function coreNative(
  def: ActionDefinition,
  effect: ActionEffectHandler,
): RegisteredAction {
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
  { name: "docs", source: "bundled", actions: bundledDocs },
  { name: "canvas", source: "bundled", actions: bundledCanvas },
];

async function buildRegistry(root: string | null): Promise<Registry> {
  const actions: RegisteredAction[] = [...CORE_ACTIONS];
  const byId = new Map<string, RegisteredAction>();
  for (const action of CORE_ACTIONS) byId.set(action.def.id, action);

  const extensions: RegistryExtension[] = [];
  const failures: ExtensionFailure[] = [];

  const register = (ext: LoadedExtension): void => {
    const registered: RegisteredAction[] = [];
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
    extensions.push({ name: ext.name, source: ext.source, actions: registered });
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

  return { actions, byId, extensions, failures, manifestEntries };
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

export async function listDefinitions(
  root?: string,
): Promise<readonly ActionDefinition[]> {
  return (await registryFor(root ?? null)).actions.map((a) => a.def);
}

/** True when the registered action dispatches through an Effect handler. */
export function isEffectNativeAction(action: RegisteredAction): boolean {
  return typeof action.effect === "function";
}

const parseInputEffect = Effect.fn("kb.parseActionInput")(
  function* (
    schema: ActionSchema,
    input: unknown,
  ): Effect.fn.Return<unknown, ActionSchemaError | DomainError> {
    return yield* Effect.tryPromise({
      try: () => parseActionInput(schema, input),
      catch: (err) => {
        if (err instanceof ActionSchemaError) return err;
        if (isZodError(err)) {
          return new ActionSchemaError(err.message, [
            { message: err.message },
          ]);
        }
        if (err instanceof ResolveError) return domainFromResolve(err);
        if (isDomainError(err)) return err;
        return new ActionSchemaError(
          err instanceof Error ? err.message : String(err),
          [{ message: err instanceof Error ? err.message : String(err) }],
        );
      },
    });
  },
);

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
export const invokeEffect = Effect.fn("kb.invoke")(
  function* (
    ctx: KbContext,
    invocation: ActionInvocation,
  ): Effect.fn.Return<
    ActionReceipt,
    ActionSchemaError | DomainError | Error,
    ActionHandlerEnv
  > {
    const { id, input } = invocation;
    // Registry discovery still uses dynamic import (external boundary).
    const registry = yield* Effect.tryPromise({
      try: () => registryFor(ctx.root),
      catch: (err) =>
        err instanceof Error ? err : new Error(String(err)),
    });
    const entry = registry.byId.get(id);
    if (!entry) return failed(id, "unknown_action", `unknown action: ${id}`);

    const parsed = yield* parseInputEffect(entry.def.inputSchema, input);

    if (entry.effect) {
      const output = yield* Effect.scoped(
        entry.effect(parsed as never),
      ).pipe(Effect.mapError(mapHandlerError));
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
  },
);

/**
 * Effect invoke that always succeeds with an {@link ActionReceipt}.
 * Surfaces compose this inside Effect programs; typed failures from
 * {@link invokeEffect} are mapped through the canonical receipt mapper.
 * Requires {@link ActionHandlerEnv} so native handlers receive Layers.
 */
export const invokeReceiptEffect = Effect.fn("kb.invokeReceipt")(
  function* (
    ctx: KbContext,
    invocation: ActionInvocation,
  ): Effect.fn.Return<ActionReceipt, never, ActionHandlerEnv> {
    return yield* invokeEffect(ctx, invocation).pipe(
      Effect.catch((err) =>
        Effect.succeed(receiptFromError(invocation.id, err)),
      ),
    );
  },
);

/**
 * Invoke an action. Never throws across this boundary — failures become receipts.
 * Thin Promise compatibility edge over {@link invokeReceiptEffect} + live Layers.
 */
export async function invoke(
  ctx: KbContext,
  invocation: ActionInvocation,
): Promise<ActionReceipt> {
  const exit = await Effect.runPromiseExit(
    invokeReceiptEffect(ctx, invocation).pipe(
      Effect.provide(kbRuntimeLayer(ctx)),
    ),
  );
  if (Exit.isSuccess(exit)) return exit.value;
  return receiptFromError(invocation.id, Cause.squash(exit.cause));
}

function receiptFromError(id: string, err: unknown): ActionReceipt {
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
    const parsed = FailureCodeSchema.safeParse(
      (err as { code?: unknown }).code,
    );
    if (parsed.success) {
      return failed(
        id,
        parsed.data,
        err.message,
        (err as { details?: unknown }).details,
      );
    }
    return failed(id, "internal", err.message);
  }
  return failed(id, "internal", String(err));
}

function isZodError(
  err: unknown,
): err is Error & { issues: unknown } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "ZodError"
  );
}

// Type-only reference keeps the public extension contract exported from
// one place; see extensions.ts for the module shape.
export type { ExtensionAction, ExtensionFailure };
