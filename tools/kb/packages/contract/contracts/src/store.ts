import type { Effect } from "effect";
import type { DomainError, KbNode, StoreTx } from "@kb/model";

/**
 * What the store looked like at one moment, as a value a session can hold and
 * compare. Opaque on purpose: callers ask "is this the store I last saw?", and
 * only the store knows what makes that true — {@link JsonlStore} builds one
 * from the file's size and mtime, a future SQLite store would use its own
 * change counter. A string because equality is the whole interface.
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
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;
  /**
   * The store's current fingerprint, or null when it cannot say (no store
   * written yet, or the backend has no cheap answer). Null never compares
   * equal to anything, so a session that gets one reloads.
   */
  readonly fingerprint: Effect.Effect<StoreFingerprint | null>;
  commitEffect(tx: StoreTx): Effect.Effect<void, DomainError>;
}
