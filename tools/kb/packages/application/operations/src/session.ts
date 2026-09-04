import { Effect, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { type DomainError, domainError, txIntegrityError, type StoreTx } from "@kb/model";
import { KbStore, type KbContext } from "@kb/contracts";

/**
 * What the store file looked like the last time this session read or wrote it.
 *
 * Reload exists for one reason — another process may have written the store —
 * and that question has a cheap answer. Without it, every defensive reload
 * (the HTTP path before each action, the watcher after each write) pays a full
 * parse and index build to discover that nothing changed, and a session's own
 * write looks exactly like someone else's.
 *
 * Kept beside reload rather than on `KbContext`: it is this module's memory of
 * the file, not part of the session's contract. Size plus mtime is the cheap
 * check the brief asks for; a write that lands within the same mtime tick *and*
 * keeps the byte count identical is invisible to it, which is the price of not
 * hashing the file (p1 Phase 3's fingerprint closes that).
 */
interface StoreStamp {
  size: number;
  mtimeMs: number;
}

const stamps = new WeakMap<KbContext, StoreStamp>();

const stampOf = Effect.fn("kb.storeStamp")(function* (
  path: string,
): Effect.fn.Return<StoreStamp | null, never, FileSystem> {
  const fs = yield* FileSystem;
  return yield* fs.stat(path).pipe(
    Effect.map((info) => ({
      size: Number(info.size),
      mtimeMs: Option.isSome(info.mtime) ? info.mtime.value.getTime() : 0,
    })),
    Effect.orElseSucceed(() => null),
  );
});

function same(a: StoreStamp | null, b: StoreStamp | undefined): boolean {
  return a !== null && b !== undefined && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/**
 * Record that this session's index reflects the store file as it is now.
 * Opening a session builds the index from the file it just read, so it says so
 * here; without that first stamp the next reload rebuilds an index that is
 * already correct.
 */
export const noteStoreSynced = Effect.fn("kb.noteStoreSynced")(function* (
  ctx: KbContext,
  path: string,
): Effect.fn.Return<void, never, FileSystem> {
  const stamp = yield* stampOf(path);
  if (stamp !== null) stamps.set(ctx, stamp);
});

/**
 * Bring the session up to date with the store. A no-op when the store file is
 * the one this session last read or wrote.
 *
 * The index keeps its virtual nodes (saved queries materialised by `kb ui`,
 * which live in the index and never in jsonl) across the rebuild, so a
 * post-write reload cannot leave the graph empty of them — and a `sys.query.*`
 * that really was persisted and then deleted cannot resurrect, because it was
 * never in the virtual set.
 */
export const reloadEffect = Effect.fn("kb.reload")(function* (
  ctx: KbContext,
): Effect.fn.Return<void, DomainError, KbStore | FileSystem> {
  const store = yield* KbStore;
  const stamp = yield* stampOf(store.path);
  if (same(stamp, stamps.get(ctx))) return;
  ctx.index.rebuild(yield* store.loadEffect);
  if (stamp !== null) stamps.set(ctx, stamp);
});

/**
 * Commit a transaction and move the index with it.
 *
 * The catch-up first is not defensive noise: the store commits under a lock by
 * reloading, merging and replacing the whole file, so anything another process
 * wrote lands in the file this commit produces. Applying only `tx` to an index
 * that has not seen those nodes would leave the session quietly behind its own
 * store — and the stamp taken afterwards would call that state current. Catching
 * up first also means integrity is checked against the graph the commit will
 * actually merge into.
 */
export const persistEffect = Effect.fn("kb.persist")(function* (
  ctx: KbContext,
  tx: StoreTx,
): Effect.fn.Return<void, DomainError, KbStore | FileSystem> {
  const store = yield* KbStore;
  yield* reloadEffect(ctx);
  const integrityError = txIntegrityError(ctx.nodes, tx);
  if (integrityError !== null && integrityError !== "") {
    return yield* domainError("invalid_input", `invalid graph transaction: ${integrityError}`);
  }
  yield* store.commitEffect(tx);
  ctx.index.applyTx(tx);
  const stamp = yield* stampOf(store.path);
  if (stamp !== null) stamps.set(ctx, stamp);
  return undefined;
});
