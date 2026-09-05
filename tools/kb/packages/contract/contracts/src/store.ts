import type { Effect } from "effect";
import type { DomainError, KbNode, StoreTx } from "@kb/model";

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
  commitEffect(tx: StoreTx): Effect.Effect<void, DomainError>;
}
