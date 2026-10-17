/**
 * A session over a store, and kb's own write through it. Opening seeds and
 * migrates a store, `kb store init` creates one and `kb store migrate`
 * copies one into another backend: each is kb writing what the store holds
 * of its own accord, never a person's or an agent's write. Each still goes
 * through the one commit owner (`persistEffect`), as a write of kb's own
 * schema (`systemWrites: "system"`) and outside whatever call is running,
 * so that the store's commit has exactly one caller.
 */
import { Effect } from "effect";
import { CurrentCall, KbStore, TxOrigin, type EffectStore, type KbContext } from "@kb/contracts";
import type { DomainError, KbNode, StoreTx } from "@kb/model";
import { noteStoreSynced, persistEffect } from "@kb/operations";
import { DatascriptIndex, type DerivedRef } from "@kb/query";
import { StoreTxLog } from "@kb/tx-log";

/**
 * A session over `store`, the store of `root`, whose nodes are `nodes` as
 * the store holds them now: the index built over them once, with the
 * references the root's families derive (`derived`), the log over the
 * store's tail, and the session marked as caught up. Opening makes one
 * after its migrations; a surface that holds a store of its own (the
 * client) makes one over what it read.
 */
export const sessionOver = Effect.fn("kb.sessionOver")(function* (
  root: string,
  store: EffectStore,
  nodes: readonly KbNode[],
  derived: readonly DerivedRef[],
): Effect.fn.Return<KbContext> {
  const index = new DatascriptIndex([...nodes], { derived });
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

/** Commit `tx` in `ctx`'s session as kb's own write: of its own schema, outside any call. */
export const persistOwnWrite = Effect.fn("kb.persistOwnWrite")(function* (
  ctx: KbContext,
  tx: StoreTx,
): Effect.fn.Return<void, DomainError> {
  yield* persistEffect(ctx, tx, { systemWrites: "system" }).pipe(
    Effect.provideService(KbStore, ctx.store),
    Effect.provideService(CurrentCall, null),
    Effect.provideService(TxOrigin, undefined),
  );
});
