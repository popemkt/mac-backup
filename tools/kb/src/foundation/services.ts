import { Context, Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import type { KbNode } from "./model.ts";
import { ensureSystemSeed } from "./seed.ts";
import type { Store, StoreTx } from "./storage/index.ts";
import { JsonlStore } from "./storage/index.ts";
import {
  buildQueryDb,
  type QueryDb,
} from "./query/index.ts";
import { domainError, type DomainError } from "./errors.ts";

/**
 * Mutable kb session state. Surfaces still pass this object; Effect programs
 * receive it via {@link KbCtx}.
 */
export interface KbContext {
  root: string;
  store: Store;
  nodes: KbNode[];
  qdb: QueryDb;
}

/** Promise-shaped Store port, provided as an Effect service. */
export class KbStore extends Context.Service<KbStore, Store>()("kb/KbStore") {}

/** Live kb session (nodes + qdb + store). */
export class KbCtx extends Context.Service<KbCtx, KbContext>()("kb/KbCtx") {}

export const bunFileSystemLayer: Layer.Layer<FileSystem> = BunFileSystem.layer;

export function kbStoreLayer(store: Store): Layer.Layer<KbStore> {
  return Layer.succeed(KbStore, store);
}

export function kbCtxLayer(ctx: KbContext): Layer.Layer<KbCtx> {
  return Layer.succeed(KbCtx, ctx);
}

/** Full runtime for a root: Bun FileSystem + JsonlStore + opened KbCtx. */
export function kbRuntimeLayer(
  ctx: KbContext,
): Layer.Layer<FileSystem | KbStore | KbCtx> {
  return Layer.mergeAll(
    bunFileSystemLayer,
    kbStoreLayer(ctx.store),
    kbCtxLayer(ctx),
  );
}

export const openKbEffect = Effect.fn("kb.open")(
  function* (root: string): Effect.fn.Return<KbContext, DomainError> {
    const store = new JsonlStore(root);
    let nodes = yield* Effect.tryPromise({
      try: () => store.load(),
      catch: (err) =>
        domainError(
          "internal",
          err instanceof Error ? err.message : String(err),
        ),
    });
    const { nodes: seeded, seeded: didSeed, deletes } = ensureSystemSeed(nodes);
    if (didSeed || nodes.length === 0 || deletes.length > 0) {
      nodes = seeded;
      yield* Effect.tryPromise({
        try: () => store.commit({ upserts: nodes, deletes }),
        catch: (err) =>
          domainError(
            "internal",
            err instanceof Error ? err.message : String(err),
          ),
      });
    } else {
      nodes = seeded;
    }
    const qdb = buildQueryDb(nodes);
    return { root, store, nodes, qdb };
  },
);

export const reloadEffect = Effect.fn("kb.reload")(
  function* (ctx: KbContext): Effect.fn.Return<void, DomainError> {
    ctx.nodes = yield* Effect.tryPromise({
      try: () => ctx.store.load(),
      catch: (err) =>
        domainError(
          "internal",
          err instanceof Error ? err.message : String(err),
        ),
    });
    ctx.qdb = buildQueryDb(ctx.nodes);
  },
);

export const persistEffect = Effect.fn("kb.persist")(
  function* (
    ctx: KbContext,
    tx: StoreTx,
  ): Effect.fn.Return<void, DomainError> {
    yield* Effect.tryPromise({
      try: () => ctx.store.commit(tx),
      catch: (err) =>
        domainError(
          "internal",
          err instanceof Error ? err.message : String(err),
        ),
    });
    const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
    for (const id of tx.deletes) byId.delete(id);
    for (const n of tx.upserts) byId.set(n.id, n);
    ctx.nodes = [...byId.values()];
    ctx.qdb = buildQueryDb(ctx.nodes);
  },
);

/** Run an Effect that needs KbCtx (+ Bun FileSystem) against a live session. */
export function runWithKb<A, E>(
  ctx: KbContext,
  effect: Effect.Effect<A, E, KbCtx | FileSystem | KbStore>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(kbRuntimeLayer(ctx))));
}
