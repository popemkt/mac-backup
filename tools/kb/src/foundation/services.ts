import { Context, Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { SYSTEM_IDS, type KbNode } from "./model.ts";
import { ensureSystemSeed } from "./seed.ts";
import type { EffectStore, Store, StoreTx } from "./storage/index.ts";
import { JsonlStore, asPromiseStore } from "./storage/index.ts";
import { bunFileSystemLayer } from "./platform.ts";
import { buildQueryDb, type QueryDb } from "./query/index.ts";
import type { DomainError } from "./errors.ts";
import { txIntegrityError } from "./tx-validation.ts";
import { migrateOrderKeys } from "./order.ts";

/**
 * UI materializes saved-query nodes into `ctx.qdb` only (never jsonl).
 * reload/persist must not drop them when rebuilding qdb — otherwise a
 * post-write fs.watch reload that hash-no-ops in the hub leaves qdb empty
 * of virtual nodes (see W4 query-nodes WS coverage).
 *
 * Only preserve query nodes that were never in the prior persisted snapshot.
 * A real `sys.query.*` that lived in jsonl and was deleted must not resurrect
 * from the stale qdb as a synthetic/virtual node.
 */
function isVirtualQueryNode(n: KbNode): boolean {
  return n.id === SYSTEM_IDS.queriesRoot || n.id.startsWith("sys.query.");
}

function rebuildQdb(
  ctx: KbContext,
  nodes: KbNode[],
  previousRealIds: Set<string>,
): QueryDb {
  const realIds = new Set(nodes.map((n) => n.id));
  const virtual: KbNode[] = [];
  if (ctx.qdb) {
    for (const n of ctx.qdb.nodes.values()) {
      if (
        !realIds.has(n.id) &&
        isVirtualQueryNode(n) &&
        !previousRealIds.has(n.id)
      ) {
        virtual.push(n);
      }
    }
  }
  return buildQueryDb(virtual.length > 0 ? [...nodes, ...virtual] : nodes);
}

export { bunFileSystemLayer } from "./platform.ts";

/**
 * Mutable kb session state. Surfaces still pass this object; Effect programs
 * receive it via {@link KbCtx}.
 */
export interface KbContext {
  root: string;
  /** Promise Store facade (tests / legacy). Effect code uses {@link KbStore}. */
  store: Store;
  /** Effect-native store instance (same JsonlStore as `store` when live). */
  effectStore: EffectStore;
  nodes: KbNode[];
  qdb: QueryDb;
}

/**
 * Effect-native Store port. Live consumers: {@link reloadEffect} /
 * {@link persistEffect} (yield* KbStore → loadEffect/commitEffect).
 */
export class KbStore extends Context.Service<KbStore, EffectStore>()(
  "kb/KbStore",
) {}

/** Live kb session (nodes + qdb + store). */
export class KbCtx extends Context.Service<KbCtx, KbContext>()("kb/KbCtx") {}

export function kbStoreLayer(store: EffectStore): Layer.Layer<KbStore> {
  return Layer.succeed(KbStore, store);
}

/** Layer that constructs a JsonlStore for `root` (still needs FileSystem at use). */
export function jsonlStoreLayer(root: string): Layer.Layer<KbStore> {
  return Layer.succeed(KbStore, new JsonlStore(root));
}

export function kbCtxLayer(ctx: KbContext): Layer.Layer<KbCtx> {
  return Layer.succeed(KbCtx, ctx);
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
  const { nodes: seeded, seeded: didSeed, deletes } = ensureSystemSeed(nodes);
  const migrated = migrateOrderKeys(seeded);
  if (didSeed || nodes.length === 0 || deletes.length > 0 || migrated.changed) {
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

export const reloadEffect = Effect.fn("kb.reload")(
  function* (
    ctx: KbContext,
  ): Effect.fn.Return<void, DomainError, KbStore | FileSystem> {
    const store = yield* KbStore;
    const previousRealIds = new Set(ctx.nodes.map((n) => n.id));
    ctx.nodes = yield* store.loadEffect();
    ctx.qdb = rebuildQdb(ctx, ctx.nodes, previousRealIds);
  },
);

export const persistEffect = Effect.fn("kb.persist")(
  function* (
    ctx: KbContext,
    tx: StoreTx,
  ): Effect.fn.Return<void, DomainError, KbStore | FileSystem> {
    const store = yield* KbStore;
    const integrityError = txIntegrityError(ctx.nodes, tx);
    if (integrityError) {
      return yield* Effect.fail({
        _tag: "Kb/DomainError",
        code: "invalid_input",
        message: `invalid graph transaction: ${integrityError}`,
      } as DomainError);
    }
    const previousRealIds = new Set(ctx.nodes.map((n) => n.id));
    yield* store.commitEffect(tx);
    const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
    for (const id of tx.deletes) byId.delete(id);
    for (const n of tx.upserts) byId.set(n.id, n);
    ctx.nodes = [...byId.values()];
    ctx.qdb = rebuildQdb(ctx, ctx.nodes, previousRealIds);
  },
);

/** Run an Effect that needs KbCtx (+ Bun FileSystem) against a live session. */
export function runWithKb<A, E>(
  ctx: KbContext,
  effect: Effect.Effect<A, E, KbCtx | FileSystem | KbStore>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(kbRuntimeLayer(ctx))));
}
