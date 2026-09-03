import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { currentIso } from "./model.ts";
import { ensureSystemSeed } from "./seed.ts";
import { JsonlStore, asPromiseStore } from "./storage/index.ts";
import { bunFileSystemLayer } from "./platform.ts";
import { buildQueryDb } from "./query/index.ts";
import type { DomainError } from "./errors.ts";
import { migrateFieldTypeValues } from "./field-type.ts";
import { migrateOrderKeys } from "./order.ts";
import {
  KbCtx,
  KbStore,
  kbCtxLayer,
  kbStoreLayer,
  type KbContext,
} from "./session.ts";

/** Layer that constructs a JsonlStore for `root` (still needs FileSystem at use). */
export function jsonlStoreLayer(root: string): Layer.Layer<KbStore> {
  return Layer.succeed(KbStore, new JsonlStore(root));
}

/** Full runtime for a root: Bun FileSystem + EffectStore + opened KbCtx. */
export function kbRuntimeLayer(
  ctx: KbContext,
): Layer.Layer<FileSystem | KbStore | KbCtx> {
  return Layer.mergeAll(
    bunFileSystemLayer,
    kbStoreLayer(ctx.effectStore),
    kbCtxLayer(ctx),
  );
}

export const openKbEffect = Effect.fn("kb.open")(
  function* (
    root: string,
  ): Effect.fn.Return<KbContext, DomainError, FileSystem> {
    const effectStore = new JsonlStore(root);
    let nodes = yield* effectStore.loadEffect();
  const at = yield* currentIso;
  const { nodes: seeded, seeded: didSeed, deletes } = ensureSystemSeed(nodes, at);
  const typed = migrateFieldTypeValues(seeded);
  const migrated = migrateOrderKeys(typed.nodes);
  if (
    didSeed ||
    nodes.length === 0 ||
    deletes.length > 0 ||
    typed.changed ||
    migrated.changed
  ) {
    nodes = migrated.nodes;
    yield* effectStore.commitEffect({ upserts: nodes, deletes });
  } else {
    nodes = migrated.nodes;
    }
    const qdb = buildQueryDb(nodes);
    const store = asPromiseStore(effectStore);
    return { root, store, effectStore, nodes, qdb };
  },
);

/** Run an Effect that needs KbCtx (+ Bun FileSystem) against a live session. */
export function runWithKb<A, E>(
  ctx: KbContext,
  effect: Effect.Effect<A, E, KbCtx | FileSystem | KbStore>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(kbRuntimeLayer(ctx))));
}
