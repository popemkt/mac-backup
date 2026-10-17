import { Cause, Effect, Layer } from "effect";
import { bunFileSystemLayer } from "./platform.ts";
import { KbIndexService } from "@kb/query";
import {
  ActionCatalog,
  ExtensionCatalog,
  FamilyKernels,
  type HostedFamilies,
  type ActionHandlerEnv,
  kbCtxLayer,
  kbStoreLayer,
  failed,
  type KbContext,
  CoreInvoke,
  type CoreInvoker,
  type Screens,
  TemplateRegistry,
  ViewCatalog,
} from "@kb/contracts";
import { UntrustedEngine } from "@kb/sandbox";
import { quickjsEngine } from "@kb/sandbox-quickjs";
import {
  assetsLayer,
  codeTrustLayer,
  legacyDocsViewsLayer,
  savedQueriesLayer,
} from "@kb/workspace-fs";
import { graphWritesLayer } from "@kb/operations";
import { invokeReceiptEffect, receiptFromError, sessionRegistry } from "./registry.ts";
import { kbRootsLayer } from "./roots.ts";
import { remoteScreensLayer } from "./screens.ts";

/**
 * Full runtime for a root: Bun FileSystem + EffectStore + opened KbCtx +
 * core's write path over that session (`GraphWrites`) + the workspace ports
 * backed by `.kb/` on disk + the UI tabs' screens, held by the `kb ui`
 * serving the root + the view catalog the registry's plugins
 * contributed + QuickJS as the engine untrusted code runs on and the invoke
 * core under code it runs (`UntrustedEngine` and `CoreInvoke`, which a view's
 * figure and a script run once run code on and call actions through) + the render templates and the action
 * catalog the registry resolved from core, bundled and `.kb/extensions`
 * contributions.
 *
 * This is where "the actions run anywhere" is paid for: the actions ask for
 * {@link SavedQueries}, {@link Assets}, `CodeTrust` and `Screens`, and this
 * composition root is the only place that says those are files under
 * `ctx.root` and a server found through it. `KbRoots` is the other roots on
 * this machine, each opened as this one is.
 *
 * `screens` is where the tabs are. Every process but the `kb ui` server
 * reaches that server's (the default); the server holds them itself and
 * passes its own, so it never has a way to ask itself.
 *
 * `hosted` is what the host composes beside the registry (the `kb ui`
 * server's agent): the extension catalog reports its rows, read at each
 * call, after the registry's families, and its kernel is one of the
 * `FamilyKernels` beside the registry's. A process that hosts nothing
 * reports none.
 */
export function kbRuntimeLayer(
  ctx: KbContext,
  screens: Layer.Layer<Screens> = remoteScreensLayer(ctx.root).pipe(
    Layer.provide(bunFileSystemLayer),
  ),
  hosted?: HostedFamilies,
): Layer.Layer<ActionHandlerEnv> {
  const registry = sessionRegistry(ctx).pipe(Effect.provide(bunFileSystemLayer));
  return Layer.mergeAll(
    bunFileSystemLayer,
    kbStoreLayer(ctx.store),
    kbCtxLayer(ctx),
    graphWritesLayer.pipe(Layer.provide(Layer.merge(kbCtxLayer(ctx), kbStoreLayer(ctx.store)))),
    Layer.succeed(KbIndexService, ctx.index),
    savedQueriesLayer(ctx.root).pipe(Layer.provide(bunFileSystemLayer)),
    assetsLayer(ctx.root).pipe(Layer.provide(bunFileSystemLayer)),
    codeTrustLayer(ctx.root).pipe(Layer.provide(bunFileSystemLayer)),
    legacyDocsViewsLayer(ctx.root).pipe(Layer.provide(bunFileSystemLayer)),
    kbRootsLayer.pipe(Layer.provide(bunFileSystemLayer)),
    screens,
    Layer.effect(TemplateRegistry, registry.pipe(Effect.map(({ templates }) => templates))),
    Layer.effect(ViewCatalog, registry.pipe(Effect.map(({ views }) => views))),
    Layer.effect(
      ExtensionCatalog,
      Effect.all([registry, hosted?.rows ?? Effect.succeed([])]).pipe(
        Effect.map(([{ families }, rows]) => [...families, ...rows]),
      ),
    ),
    Layer.effect(
      FamilyKernels,
      registry.pipe(
        Effect.map(({ kernel }) => [
          { source: "registry" as const, kernel },
          ...(hosted === undefined ? [] : [{ source: "host" as const, kernel: hosted.kernel }]),
        ]),
      ),
    ),
    Layer.succeed(UntrustedEngine, quickjsEngine),
    Layer.succeed(CoreInvoke, coreInvoke(ctx)),
    Layer.effect(
      ActionCatalog,
      registry.pipe(Effect.map(({ manifestEntries }) => manifestEntries)),
    ),
  );
}

/**
 * The invoke core on this root, for code it is already running
 * (`CoreInvoke`): within `read`, a call to an action that writes is refused
 * before the core; any other call runs through it, decided like every call.
 */
function coreInvoke(ctx: KbContext): CoreInvoker {
  return (invocation, scope) =>
    Effect.gen(function* () {
      const registry = yield* sessionRegistry(ctx);
      const mode = registry.byId.get(invocation.id)?.def.mode;
      if (scope === "read" && mode !== undefined && mode.kind !== "read") {
        return failed(
          invocation.id,
          "forbidden",
          `${invocation.id} is a write, and a call made while reading may only read`,
        );
      }
      return yield* invokeReceiptEffect(ctx, invocation).pipe(Effect.provide(kbRuntimeLayer(ctx)));
    }).pipe(
      Effect.provide(bunFileSystemLayer),
      Effect.catchCause((cause) =>
        Effect.succeed(receiptFromError(invocation.id, Cause.squash(cause))),
      ),
    );
}

/** Run an Effect that needs KbCtx (+ Bun FileSystem) against a live session. */
export function runWithKb<A, E>(
  ctx: KbContext,
  effect: Effect.Effect<A, E, ActionHandlerEnv>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(kbRuntimeLayer(ctx))));
}
