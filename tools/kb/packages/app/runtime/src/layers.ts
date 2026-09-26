import { Effect, Layer } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  currentIso,
  applyTx,
  diffTx,
  ensureSystemSeed,
  migrateFieldTypeValues,
  type DomainError,
  type KbNode,
} from "@kb/model";
import { bunFileSystemLayer } from "./platform.ts";
import { DatascriptIndex, KbIndexService } from "@kb/query";
import {
  type Assets,
  type KbCtx,
  KbStore,
  type SavedQueries,
  type Views,
  kbCtxLayer,
  kbStoreLayer,
  type KbContext,
  TemplateRegistry,
} from "@kb/contracts";
import { StoreTxLog } from "@kb/tx-log";
import { assetsLayer, savedQueriesLayer, viewsLayer } from "@kb/workspace-fs";
import { noteStoreSynced } from "@kb/operations";
import { registryFor } from "./registry.ts";
import { selectStore } from "./store-selection.ts";

/**
 * Full runtime for a root: Bun FileSystem + EffectStore + opened KbCtx +
 * the three workspace ports backed by `.kb/` on disk + the render templates
 * the registry resolved from core-bundled and `.kb/extensions` contributions.
 *
 * This is where "the actions run anywhere" is paid for: the actions ask for
 * {@link SavedQueries}, {@link Views} and {@link Assets}, and this composition
 * root is the only place that says those are directories under `ctx.root`.
 */
export function kbRuntimeLayer(
  ctx: KbContext,
): Layer.Layer<
  FileSystem | KbStore | KbCtx | KbIndexService | TemplateRegistry | SavedQueries | Views | Assets
> {
  return Layer.mergeAll(
    bunFileSystemLayer,
    kbStoreLayer(ctx.store),
    kbCtxLayer(ctx),
    Layer.succeed(KbIndexService, ctx.index),
    savedQueriesLayer(ctx.root).pipe(Layer.provide(bunFileSystemLayer)),
    viewsLayer(ctx.root).pipe(Layer.provide(bunFileSystemLayer)),
    assetsLayer(ctx.root).pipe(Layer.provide(bunFileSystemLayer)),
    Layer.effect(
      TemplateRegistry,
      registryFor(ctx.root).pipe(
        Effect.map((registry) => registry.templates),
        Effect.provide(bunFileSystemLayer),
      ),
    ),
  );
}

/**
 * Open a session over the root's store.
 *
 * Opening is a read. It writes only when a real migration runs — the system
 * seed adds or retires nodes, or a field-type value is rewritten — and then it
 * commits exactly the nodes that migration changed, never the whole set. Ranks
 * are not a migration: a node without one is ordered by `compareRootOrder`
 * in memory and ranked by the store on the next commit that writes its
 * sibling group (DESIGN.md → Sibling ranks), so reopening a store leaves its
 * bytes, its fingerprint and its tail alone.
 */
export const openKbEffect = Effect.fn("kb.open")(function* (
  root: string,
): Effect.fn.Return<KbContext, DomainError, FileSystem> {
  const store = yield* selectStore(root);
  const loaded = yield* store.loadEffect;
  const at = yield* currentIso;
  const { nodes: seeded, seeded: didSeed, deletes } = ensureSystemSeed(loaded, at);
  const typed = migrateFieldTypeValues(seeded);
  let nodes = loaded;
  if (didSeed || deletes.length > 0 || typed.changed) {
    const commit = yield* store.commitEffect(diffTx(loaded, typed.nodes), { at });
    nodes = [...applyTx(loaded, commit.tx).values()];
  }
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
  effect: Effect.Effect<
    A,
    E,
    KbCtx | KbIndexService | FileSystem | KbStore | TemplateRegistry | SavedQueries | Views | Assets
  >,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(kbRuntimeLayer(ctx))));
}
