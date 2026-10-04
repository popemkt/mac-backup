import { Cause, Effect, Layer } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  currentIso,
  applyTx,
  diffTx,
  ensureSystemSeed,
  migrateDateValues,
  migrateFieldTypeValues,
  legacyViewShapes,
  type DomainError,
  type KbNode,
} from "@kb/model";
import { bundledSeed } from "@kb/bundled";
import { bunFileSystemLayer } from "./platform.ts";
import { DatascriptIndex, KbIndexService } from "@kb/query";
import {
  ActionCatalog,
  ExtensionCatalog,
  type ExtensionRow,
  type ActionHandlerEnv,
  KbStore,
  kbCtxLayer,
  kbStoreLayer,
  failed,
  type ActionInvocation,
  type KbContext,
  ReadInvoke,
  type ReadInvoker,
  type Screens,
  TemplateRegistry,
  ViewCatalog,
} from "@kb/contracts";
import { UntrustedEngine } from "@kb/sandbox";
import { quickjsEngine } from "@kb/sandbox-quickjs";
import { StoreTxLog } from "@kb/tx-log";
import {
  assetsLayer,
  codeTrustLayer,
  legacyDocsViewsLayer,
  readLegacyDocsViews,
  savedQueriesLayer,
} from "@kb/workspace-fs";
import { graphWritesLayer, noteStoreSynced } from "@kb/operations";
import { invokeReceiptEffect, receiptFromError, sessionRegistry } from "./registry.ts";
import { remoteScreensLayer } from "./screens.ts";
import { selectStore } from "./store-selection.ts";

/**
 * Full runtime for a root: Bun FileSystem + EffectStore + opened KbCtx +
 * core's write path over that session (`GraphWrites`) + the workspace ports
 * backed by `.kb/` on disk + the UI tabs' screens, held by the `kb ui`
 * serving the root + the view catalog the registry's plugins
 * contributed + QuickJS as the engine untrusted code runs on and the invoke
 * core as a read (`UntrustedEngine` and `ReadInvoke`, which a view's figure
 * runs code on and calls actions through) + the render templates and the action
 * catalog the registry resolved from core, bundled and `.kb/extensions`
 * contributions.
 *
 * This is where "the actions run anywhere" is paid for: the actions ask for
 * {@link SavedQueries}, {@link Assets}, `CodeTrust` and `Screens`, and this
 * composition root is the only place that says those are files under
 * `ctx.root` and a server found through it.
 *
 * `screens` is where the tabs are. Every process but the `kb ui` server
 * reaches that server's (the default); the server holds them itself and
 * passes its own, so it never has a way to ask itself.
 *
 * `hosted` is what the host composes beside the registry (the `kb ui`
 * server's agent), read at each call: the extension catalog reports it after
 * the registry's families. A process that hosts nothing reports none.
 */
export function kbRuntimeLayer(
  ctx: KbContext,
  screens: Layer.Layer<Screens> = remoteScreensLayer(ctx.root).pipe(
    Layer.provide(bunFileSystemLayer),
  ),
  hosted: () => readonly ExtensionRow[] = () => [],
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
    screens,
    Layer.effect(TemplateRegistry, registry.pipe(Effect.map(({ templates }) => templates))),
    Layer.effect(ViewCatalog, registry.pipe(Effect.map(({ views }) => views))),
    Layer.effect(
      ExtensionCatalog,
      registry.pipe(Effect.map(({ families }) => [...families, ...hosted()])),
    ),
    Layer.succeed(UntrustedEngine, quickjsEngine),
    Layer.succeed(ReadInvoke, readInvoke(ctx)),
    Layer.effect(
      ActionCatalog,
      registry.pipe(Effect.map(({ manifestEntries }) => manifestEntries)),
    ),
  );
}

/**
 * The invoke core on this root, as a read (`ReadInvoke`): a call to an
 * action that writes is refused before the core, and any other runs through
 * it, decided like every call.
 */
function readInvoke(ctx: KbContext): ReadInvoker {
  return (invocation: ActionInvocation) =>
    Effect.gen(function* () {
      const registry = yield* sessionRegistry(ctx);
      const mode = registry.byId.get(invocation.id)?.def.mode;
      if (mode !== undefined && mode.kind !== "read") {
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

/**
 * Warn, and only warn, that a store or its root still holds what came before
 * view nodes: the shapes `views.migrate` rewrites and the spec files it
 * imports.
 */
const reportLegacyViews = Effect.fn("kb.open.legacyViews")(function* (
  root: string,
  nodes: KbNode[],
) {
  const files = yield* readLegacyDocsViews(root);
  const held = [
    ...legacyViewShapes(nodes),
    ...(files.views.length > 0
      ? [`.kb/views spec(s) ${files.views.map((view) => view.name).join(", ")}`]
      : []),
    ...files.skipped,
  ];
  if (held.length > 0)
    yield* Effect.logWarning(
      `kb: ${root} holds shapes from before view nodes; run the views.migrate action: ${held.join("; ")}`,
    );
});

/**
 * Open a session over the root's store.
 *
 * Opening is a read. It writes only when a real migration runs — the
 * system seed adds or retires nodes, a field-type value or a legacy date
 * value is rewritten — and then it
 * commits exactly the nodes that migration changed, never the whole set. Ranks
 * are not a migration: a node without one is ordered by `compareRootOrder`
 * in memory and ranked by the store on the next commit that writes its
 * sibling group (DESIGN.md → Sibling ranks), so reopening a store leaves its
 * bytes, its fingerprint and its tail alone.
 *
 * A store written before view nodes, or a root still keeping `.kb/views`
 * specs, is not rewritten here: that is `views.migrate`, an action a person
 * or agent runs. Opening says so, as a warning in the log.
 */
export const openKbEffect = Effect.fn("kb.open")(function* (
  root: string,
): Effect.fn.Return<KbContext, DomainError, FileSystem> {
  const store = yield* selectStore(root);
  const loaded = yield* store.loadEffect;
  const at = yield* currentIso;
  const { nodes: seeded, seeded: didSeed, deletes } = ensureSystemSeed(loaded, bundledSeed(at));
  const typed = migrateFieldTypeValues(seeded);
  const dated = migrateDateValues(typed.nodes);
  let nodes = loaded;
  if (didSeed || deletes.length > 0 || typed.changed || dated.changed) {
    const commit = yield* store.commitEffect(diffTx(loaded, dated.nodes), { at });
    nodes = [...applyTx(loaded, commit.tx).values()];
  }
  yield* reportLegacyViews(root, nodes);
  const index = new DatascriptIndex(nodes);
  const ctx: KbContext = {
    root,
    store,
    index,
    log: new StoreTxLog(store.txTail),
    get nodes(): KbNode[] {
      return index.storedNodes();
    },
  };
  yield* noteStoreSynced(ctx).pipe(Effect.provideService(KbStore, store));
  return ctx;
});

/** Run an Effect that needs KbCtx (+ Bun FileSystem) against a live session. */
export function runWithKb<A, E>(
  ctx: KbContext,
  effect: Effect.Effect<A, E, ActionHandlerEnv>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(kbRuntimeLayer(ctx))));
}
