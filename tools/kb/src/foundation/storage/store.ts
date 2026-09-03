import type { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { DomainError } from "../errors.ts";
import type { KbNode } from "../model.ts";
import type { StoreTx } from "../tx-validation.ts";

/**
 * Promise-shaped Store retained for tests, benchmarks, and `KbContext.store`.
 * Effect programs should prefer {@link EffectStore} via KbStore.
 */
export interface Store {
  readonly path: string;
  load(): Promise<KbNode[]>;
  commit(tx: StoreTx): Promise<void>;
}

/**
 * Effect-native persistence port. Methods require `FileSystem` in R — provide
 * bunFileSystemLayer (or a test Layer) at composition boundaries.
 */
export interface EffectStore {
  readonly path: string;
  loadEffect(): Effect.Effect<KbNode[], DomainError, FileSystem>;
  commitEffect(tx: StoreTx): Effect.Effect<void, DomainError, FileSystem>;
}
