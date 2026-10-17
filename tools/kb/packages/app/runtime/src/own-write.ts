/**
 * A session over a store, and kb's own write through it. Opening seeds and
 * migrates a store, `kb store init` creates one and `kb store migrate`
 * copies one into another backend: each is kb writing what the store holds
 * of its own accord, never a person's or an agent's write. Each still goes
 * through the one commit owner, as a write of kb's own schema
 * (`systemWrites: "system"`: a migration rewrites `sys.*` nodes, and a copy
 * between backends moves them, neither of which a person's write may do)
 * and outside whatever call is running, so that the store's commit has
 * exactly one caller. A write of kb's that changes what is there is planned
 * over the store as the commit finds it and lands only on that state
 * (`persistPlannedEffect`), so a write another process made meanwhile is
 * never lost.
 */
import { Effect } from "effect";
import { CurrentCall, KbStore, TxOrigin, type EffectStore, type KbContext } from "@kb/contracts";
import type { DomainError, KbNode, StoreTx } from "@kb/model";
import { noteStoreSynced, persistEffect, persistPlannedEffect } from "@kb/operations";
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

/** `effect`, a commit in `ctx`'s session, run as kb's own write: over its store, outside any call. */
function asOwnWrite<A>(
  ctx: KbContext,
  effect: Effect.Effect<A, DomainError, KbStore>,
): Effect.Effect<A, DomainError> {
  return effect.pipe(
    Effect.provideService(KbStore, ctx.store),
    Effect.provideService(CurrentCall, null),
    Effect.provideService(TxOrigin, undefined),
  );
}

/**
 * Commit what `plan` makes of the nodes `ctx`'s store holds as the commit
 * finds them, as kb's own write, planned again when the store moved first;
 * a plan answers null for nothing to write.
 */
export function persistOwnWrite(
  ctx: KbContext,
  plan: (nodes: readonly KbNode[]) => Effect.Effect<StoreTx | null, DomainError>,
): Effect.Effect<StoreTx | null, DomainError> {
  return asOwnWrite(ctx, persistPlannedEffect(ctx, plan, { systemWrites: "system" }));
}

/** Make `ctx`'s store exist: commit nothing, which writes its files and records nothing. */
export function createOwnStore(ctx: KbContext): Effect.Effect<void, DomainError> {
  return asOwnWrite(
    ctx,
    persistEffect(ctx, { upserts: [], deletes: [] }, { systemWrites: "system" }).pipe(
      Effect.asVoid,
    ),
  );
}
