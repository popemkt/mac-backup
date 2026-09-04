import { Effect } from "effect";
import { type DomainError, domainError, txIntegrityError, type StoreTx } from "@kb/model";
import { KbStore, type KbContext } from "@kb/contracts";

/**
 * Bring the session up to date with the store.
 *
 * The index keeps its virtual nodes (saved queries materialised by `kb ui`,
 * which live in the index and never in jsonl) across the rebuild, so a
 * post-write reload cannot leave the graph empty of them — and a `sys.query.*`
 * that really was persisted and then deleted cannot resurrect, because it was
 * never in the virtual set.
 */
export const reloadEffect = Effect.fn("kb.reload")(function* (
  ctx: KbContext,
): Effect.fn.Return<void, DomainError, KbStore> {
  const store = yield* KbStore;
  ctx.index.rebuild(yield* store.loadEffect);
});

export const persistEffect = Effect.fn("kb.persist")(function* (
  ctx: KbContext,
  tx: StoreTx,
): Effect.fn.Return<void, DomainError, KbStore> {
  const store = yield* KbStore;
  const integrityError = txIntegrityError(ctx.nodes, tx);
  if (integrityError !== null && integrityError !== "") {
    return yield* domainError("invalid_input", `invalid graph transaction: ${integrityError}`);
  }
  yield* store.commitEffect(tx);
  ctx.index.applyTx(tx);
  return undefined;
});
