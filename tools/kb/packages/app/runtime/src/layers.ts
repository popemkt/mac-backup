import { Effect, Layer } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  currentIso,
  ensureSystemSeed,
  migrateFieldTypeValues,
  migrateOrderKeys,
  type DomainError,
  type KbNode,
} from "@kb/model";
import { bunFileSystemLayer } from "@kb/store-jsonl";
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

export const openKbEffect = Effect.fn("kb.open")(function* (
  root: string,
): Effect.fn.Return<KbContext, DomainError, FileSystem> {
  const store = yield* selectStore(root);
  let nodes = yield* store.loadEffect;
  const at = yield* currentIso;
  const { nodes: seeded, seeded: didSeed, deletes } = ensureSystemSeed(nodes, at);
  const typed = migrateFieldTypeValues(seeded);
  const migrated = migrateOrderKeys(typed.nodes);
  if (didSeed || nodes.length === 0 || deletes.length > 0 || typed.changed || migrated.changed) {
    nodes = migrated.nodes;
    yield* store.commitEffect({ upserts: nodes, deletes }, { at });
  } else {
    nodes = migrated.nodes;
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
