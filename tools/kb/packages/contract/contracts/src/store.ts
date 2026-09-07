import type { Effect } from "effect";
import type { DomainError, KbNode, StoreTx } from "@kb/model";
import type { TxRecord, TxTail } from "./tx-log.ts";

/**
 * What the store looked like at one moment, as a value a session can hold and
 * compare. Opaque on purpose: callers ask "is this the store I last saw?", and
 * only the store knows what makes that true — {@link JsonlStore} builds one
 * from the file's size and mtime, the SQLite store from its own commit counter
 * plus sqlite's `data_version`. A string because equality is the whole
 * interface.
 */
export type StoreFingerprint = string;

/**
 * What one commit did.
 *
 * A store commits by merging: it reads the current state inside its own
 * exclusion, applies the transaction, and writes the result. So the state a
 * commit merged into is not necessarily the state its caller last read —
 * another process may have written in between, and that write is now in the
 * store whether the caller knows about it or not.
 *
 * `base` is what the commit actually merged into. A caller that had seen
 * exactly that can apply its own delta to its index; a caller that had not
 * has an index missing whatever the commit absorbed, and must reload. Null
 * means the store cannot say, which compares equal to nothing — the safe
 * direction, since it costs a reload and never a stale index.
 */
export interface StoreCommit {
  readonly base: StoreFingerprint | null;
  /** The store's fingerprint after the write. */
  readonly fingerprint: StoreFingerprint | null;
}

/**
 * Effect-native persistence port. A port that leaks its adapter's platform
 * into R is not a port: the concrete store provides its own FileSystem, so a
 * consumer of {@link EffectStore} needs nothing but the store. `loadEffect` is
 * a value, not a nullary function — an Effect is already the deferred call.
 */
export interface EffectStore {
  readonly path: string;
  /**
   * The filesystem paths whose change means "someone else wrote the store".
   * A live-reload watcher asks the store what to watch rather than deciding
   * from the adapter it thinks it has: a JSONL store is one file, a SQLite
   * store is the database plus its write-ahead log, and a future adapter is
   * whatever it says it is. `path` alone cannot answer, because a backend's
   * unit of storage is not always a single file.
   */
  readonly watchPaths: readonly string[];
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;
  /**
   * The store's current fingerprint, or null when it cannot say (no store
   * written yet, or the backend has no cheap answer). Null never compares
   * equal to anything, so a session that gets one reloads.
   */
  readonly fingerprint: Effect.Effect<StoreFingerprint | null>;
  /**
   * The durable sequence of transactions this store has committed.
   *
   * On the store because only the store can make the node write and the log
   * record one act — see {@link TxTail}. It is read and appended
   * synchronously, and it is what a session's {@link KbTxLog} is a view of.
   */
  readonly txTail: TxTail;
  /**
   * Apply `tx`, record it on {@link txTail}, and report what the store did so
   * a caller can tell its own delta from the state that delta landed in. See
   * {@link StoreCommit}.
   *
   * `record` is the caller's half of the log entry — the rev is the tail's to
   * assign. It is required rather than optional because a commit nobody
   * recorded is exactly the hole this port used to have: the transaction
   * existed, the store wrote it, and no reader could ever learn what it was.
   * An empty `tx` is not recorded (it costs a rev and a frame and says
   * nothing), so a commit whose only purpose is to create the store leaves the
   * tail alone.
   */
  commitEffect(tx: StoreTx, record: TxRecord): Effect.Effect<StoreCommit, DomainError>;
}
