import { Effect, Layer } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  currentIso,
  applyTx,
  diffTx,
  ensureSystemSeed,
  migrateDateValues,
  migrateFieldTypeValues,
  migrateToViewNodes,
  type DomainError,
  type KbNode,
} from "@kb/model";
import { bunFileSystemLayer } from "./platform.ts";
import { DatascriptIndex, KbIndexService } from "@kb/query";
import {
  ActionCatalog,
  type ActionHandlerEnv,
  KbStore,
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
 * and the action catalog the registry resolved from core, bundled and
 * `.kb/extensions` contributions.
 *
 * This is where "the actions run anywhere" is paid for: the actions ask for
 * {@link SavedQueries}, {@link Views} and {@link Assets}, and this composition
 * root is the only place that says those are directories under `ctx.root`.
 */
export function kbRuntimeLayer(ctx: KbContext): Layer.Layer<ActionHandlerEnv> {
  const registry = registryFor(ctx.root).pipe(Effect.provide(bunFileSystemLayer));
  return Layer.mergeAll(
    bunFileSystemLayer,
    kbStoreLayer(ctx.store),
    kbCtxLayer(ctx),
    Layer.succeed(KbIndexService, ctx.index),
    savedQueriesLayer(ctx.root).pipe(Layer.provide(bunFileSystemLayer)),
    viewsLayer(ctx.root).pipe(Layer.provide(bunFileSystemLayer)),
    assetsLayer(ctx.root).pipe(Layer.provide(bunFileSystemLayer)),
    Layer.effect(TemplateRegistry, registry.pipe(Effect.map(({ templates }) => templates))),
    Layer.effect(
      ActionCatalog,
      registry.pipe(Effect.map(({ manifestEntries }) => manifestEntries)),
    ),
  );
}

/**
 * Open a session over the root's store.
 *
 * Opening is a read. It writes only when a real migration runs — a store
 * written before view nodes is rewritten to them (`migrateToViewNodes`), the
 * system seed adds or retires nodes, a field-type value or a legacy date
 * value is rewritten — and then it
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
  // Before the seed, so its fill-absent pass meets the migrated shape, not the old one.
  const viewed = migrateToViewNodes(loaded);
  const { nodes: seeded, seeded: didSeed, deletes } = ensureSystemSeed(viewed.nodes, at);
  const typed = migrateFieldTypeValues(seeded);
  const dated = migrateDateValues(typed.nodes);
  let nodes = loaded;
  if (viewed.changed || didSeed || deletes.length > 0 || typed.changed || dated.changed) {
    const commit = yield* store.commitEffect(diffTx(loaded, dated.nodes), { at });
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
  effect: Effect.Effect<A, E, ActionHandlerEnv>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(kbRuntimeLayer(ctx))));
}
