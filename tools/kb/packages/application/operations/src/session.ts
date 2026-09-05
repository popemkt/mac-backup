import { Effect } from "effect";
import { type DomainError, domainError, txIntegrityError, type StoreTx } from "@kb/model";
import { KbStore, type KbContext, type StoreFingerprint } from "@kb/contracts";

/**
 * The store as this session last saw it.
 *
 * Reload exists for one reason — another process may have written the store —
 * and that question has a cheap answer. Without it, every defensive reload
 * (the HTTP path before each action, the watcher after each write) pays a full
 * parse and index build to discover that nothing changed, and a session's own
 * write looks exactly like someone else's.
 *
 * What makes two states "the same" is the store's business, not this module's:
 * it hands out an opaque {@link StoreFingerprint} and these functions only
 * compare. Kept beside reload rather than on `KbContext`: it is this module's
 * memory of the store, not part of the session's contract.
 */
const seen = new WeakMap<KbContext, StoreFingerprint>();

/**
 * Record that this session's index reflects the store as it is now.
 * Opening a session builds the index from the store it just read, so it says so
 * here; without that first mark the next reload rebuilds an index that is
 * already correct.
 */
export const noteStoreSynced = Effect.fn("kb.noteStoreSynced")(function* (
  ctx: KbContext,
): Effect.fn.Return<void, never, KbStore> {
  const store = yield* KbStore;
  const fingerprint = yield* store.fingerprint;
  if (fingerprint !== null) seen.set(ctx, fingerprint);
});

/**
 * Bring the session up to date with the store. A no-op when the store is in
 * the state this session last read or wrote.
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
  const fingerprint = yield* store.fingerprint;
  if (fingerprint !== null && fingerprint === seen.get(ctx)) return;
  ctx.index.rebuild(yield* store.loadEffect);
  if (fingerprint !== null) seen.set(ctx, fingerprint);
});

/**
 * Commit a transaction and move the index with it.
 *
 * The catch-up first is not defensive noise: the store commits under a lock by
 * reloading, merging and replacing the whole file, so anything another process
 * wrote lands in the file this commit produces. Applying only `tx` to an index
 * that has not seen those nodes would leave the session quietly behind its own
 * store — and the fingerprint taken afterwards would call that state current.
 * Catching up first also means integrity is checked against the graph the
 * commit will actually merge into.
 */
export const persistEffect = Effect.fn("kb.persist")(function* (
  ctx: KbContext,
  tx: StoreTx,
): Effect.fn.Return<void, DomainError, KbStore> {
  const store = yield* KbStore;
  yield* reloadEffect(ctx);
  const integrityError = txIntegrityError(ctx.nodes, tx);
  if (integrityError !== null && integrityError !== "") {
    return yield* domainError("invalid_input", `invalid graph transaction: ${integrityError}`);
  }
  yield* store.commitEffect(tx);
  ctx.index.applyTx(tx);
  const fingerprint = yield* store.fingerprint;
  if (fingerprint !== null) seen.set(ctx, fingerprint);
  return undefined;
});
