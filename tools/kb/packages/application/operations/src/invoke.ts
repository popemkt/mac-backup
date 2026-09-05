import { Effect, Predicate } from "effect";
import {
  type ActionDefinition,
  type ActionEffectHandler,
  type ActionHandlerEnv,
  type IsomorphicActionEnv,
  type ActionInvocation,
  type ActionReceipt,
  failed,
  succeeded,
  type ExtensionPromiseHandler,
  type KbContext,
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
import { assetUploadDef, assetUploadEffect } from "./assets.ts";
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
} from "./actions.ts";
import { ontologyMembersDef, ontologyMembersEffect } from "./ontology.ts";
import {
  renderViewActionEffect,
  renderViewDef,
  renderViewsActionEffect,
  renderViewsDef,
} from "./render.ts";

/**
 * The invoke core: one registered-action shape, the twelve core actions
 * paired with their handlers beside the definitions that own them, and the
 * one place a parsed input meets a handler and a failure becomes a receipt.
 * Runtime (server, CLI, MCP) composes this over its discovered registry; the
 * browser composes it over `coreActions` alone. Neither owns a second copy.
 */
export interface RegisteredAction<R = ActionHandlerEnv> {
  def: ActionDefinition;
  /**
   * Effect-native handler. Preferred when set — composed directly inside
   * {@link invokeEffect} (no `tryPromise`).
   */
  effect?: ActionEffectHandler<R>;
  /**
   * Legacy Promise handler. Used only when {@link RegisteredAction.effect}
   * is absent (third-party `.kb/extensions`).
   */
  handler?: ExtensionPromiseHandler;
  /** "core" | "ext:<name>" */
  source: string;
  aliases: readonly string[];
}

function coreNative<R>(def: ActionDefinition, effect: ActionEffectHandler<R>): RegisteredAction<R> {
  return { def, effect, source: "core", aliases: [] };
}

/** The eight actions every runtime can run from its own store and index. */
export const isomorphicActions: readonly RegisteredAction<IsomorphicActionEnv>[] = [
  coreNative(nodeAddDef, nodeAddEffect),
  coreNative(nodeUpdateDef, nodeUpdateEffect),
  coreNative(nodeGetDef, nodeGetEffect),
  coreNative(fieldDefineDef, fieldDefineEffect),
  coreNative(tagDefineDef, tagDefineEffect),
  coreNative(graphQueryDef, graphQueryEffect),
  coreNative(graphSearchDef, graphSearchEffect),
  coreNative(ontologyMembersDef, ontologyMembersEffect),
];

/** The four actions that reach a workspace port (saved queries, views, assets). */
export const portActions: readonly RegisteredAction[] = [
  coreNative(graphRunDef, graphRunEffect),
  coreNative(assetUploadDef, assetUploadEffect),
  coreNative(renderViewDef, renderViewActionEffect),
  coreNative(renderViewsDef, renderViewsActionEffect),
];

export const coreActions: readonly RegisteredAction[] = [...isomorphicActions, ...portActions];

/** Extensions shipped with kb itself; loaded like repo extensions. */

export function isEffectNativeAction(action: RegisteredAction): boolean {
  return typeof action.effect === "function";
}

/**
 * An extension's `effect` handler may be authored outside kb, so its declared
 * {@link ActionHandlerError} is a promise the module boundary cannot verify.
 * This is the runtime half of that promise: a failure outside the vocabulary
 * becomes an `internal` DomainError instead of escaping as a defect.
 */
function mapHandlerError(err: unknown): ActionSchemaError | DomainError {
  if (err instanceof ActionSchemaError) return err;
  return ensureDomainError(err);
}

/**
 * The one place a parsed input meets a handler that declared its own input
 * type. `(input: never)` is the standard encoding for "accepts whatever this
 * action's `inputSchema` produces", and `parsed` is what that very schema just
 * produced. A runtime check can confirm a contributed handler is a function
 * (the extension SDK's `decodeContribution` does) but never its signature, so
 * the two are joined here once rather than asserted at each call site.
 */
function asDeclaredInput(parsed: unknown): never {
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- the one sanctioned boundary trust: the SDK decodes the shape, the registry joins it to the handler signature here, once
  return parsed as never;
}

/** Pair an action's handler with its parsed input; `null` when it has neither. */
function dispatch<R>(
  entry: RegisteredAction<R>,
  ctx: KbContext,
  parsed: unknown,
): Effect.Effect<unknown, ActionSchemaError | DomainError, R> | null {
  const { effect, handler } = entry;
  if (effect) {
    return Effect.scoped(effect(asDeclaredInput(parsed))).pipe(Effect.mapError(mapHandlerError));
  }
  if (handler) {
    return Effect.tryPromise({
      try: () => handler(ctx, asDeclaredInput(parsed)),
      catch: mapHandlerError,
    });
  }
  return null;
}

/**
 * Effect invoke over a registry map — failures stay typed until a receipt mapper takes them.
 * Native handlers are composed directly (scoped); legacy Promise handlers are
 * the only path that uses `tryPromise`.
 */
export const invokeWith = Effect.fn("kb.invoke")(function* <R>(
  actions: ReadonlyMap<string, RegisteredAction<R>>,
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, ActionSchemaError | DomainError, R> {
  const { id, input } = invocation;
  const entry = actions.get(id);
  if (!entry) return failed(id, "unknown_action", `unknown action: ${id}`);

  const parsed = yield* parseActionInput(entry.def.inputSchema, input);
  const run = dispatch(entry, ctx, parsed);
  if (run === null) return failed(id, "internal", `action has no effect or handler: ${id}`);

  return succeeded(id, yield* run);
});

/**
 * Effect invoke that always succeeds with an {@link ActionReceipt}.
 * Surfaces compose this inside Effect programs; typed failures from
 * {@link invokeWith} are mapped through the canonical receipt mapper.
 * Requires {@link ActionHandlerEnv} so native handlers receive Layers.
 */
export const invokeReceiptWith = Effect.fn("kb.invokeReceipt")(function* <R>(
  actions: ReadonlyMap<string, RegisteredAction<R>>,
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, never, R> {
  return yield* invokeWith(actions, ctx, invocation).pipe(
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
    const parsed = FailureCodeSchema.safeParse(
      Predicate.hasProperty(err, "code") ? err.code : undefined,
    );
    if (parsed.success) {
      const details = Predicate.hasProperty(err, "details") ? err.details : undefined;
      return failed(id, parsed.data, err.message, details);
    }
    return failed(id, "internal", err.message);
  }
  return failed(id, "internal", String(err));
}
