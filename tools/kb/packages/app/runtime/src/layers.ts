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
import { JsonlStore, bunFileSystemLayer } from "@kb/store-jsonl";
import { DatascriptIndex, KbIndexService } from "@kb/query";
import {
  type KbCtx,
  type KbStore,
  kbCtxLayer,
  kbStoreLayer,
  type KbContext,
  TemplateRegistry,
} from "@kb/contracts";
import { MemoryTxLog } from "@kb/tx-log";
import { noteStoreSynced } from "@kb/operations";
import { registryFor } from "./registry.ts";

/**
 * Full runtime for a root: Bun FileSystem + EffectStore + opened KbCtx +
 * the render templates the registry resolved from core-bundled and
 * `.kb/extensions` contributions.
 */
export function kbRuntimeLayer(
  ctx: KbContext,
): Layer.Layer<FileSystem | KbStore | KbCtx | KbIndexService | TemplateRegistry> {
  return Layer.mergeAll(
    bunFileSystemLayer,
    kbStoreLayer(ctx.store),
    kbCtxLayer(ctx),
    Layer.succeed(KbIndexService, ctx.index),
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
  const store = new JsonlStore(root);
  let nodes = yield* store.loadEffect;
  const at = yield* currentIso;
  const { nodes: seeded, seeded: didSeed, deletes } = ensureSystemSeed(nodes, at);
  const typed = migrateFieldTypeValues(seeded);
  const migrated = migrateOrderKeys(typed.nodes);
  if (didSeed || nodes.length === 0 || deletes.length > 0 || typed.changed || migrated.changed) {
    nodes = migrated.nodes;
    yield* store.commitEffect({ upserts: nodes, deletes });
  } else {
    nodes = migrated.nodes;
  }
  const index = new DatascriptIndex(nodes);
  const ctx: KbContext = {
    root,
    store,
    index,
    log: new MemoryTxLog(),
    get nodes(): KbNode[] {
      return index.storedNodes();
    },
  };
  yield* noteStoreSynced(ctx, store.path);
  return ctx;
});

/** Run an Effect that needs KbCtx (+ Bun FileSystem) against a live session. */
export function runWithKb<A, E>(
  ctx: KbContext,
  effect: Effect.Effect<A, E, KbCtx | KbIndexService | FileSystem | KbStore | TemplateRegistry>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(kbRuntimeLayer(ctx))));
}
