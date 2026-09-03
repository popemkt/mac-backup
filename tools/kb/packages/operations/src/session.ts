import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { DomainError } from "@kb/model";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import { buildQueryDb, type QueryDb } from "@kb/query";
import { KbStore, type KbContext } from "@kb/contracts";
import { txIntegrityError, type StoreTx } from "@kb/model";

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
