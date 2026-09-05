import type { Effect } from "effect";
import type { DomainError, KbNode, StoreTx } from "@kb/model";

/**
 * Effect-native persistence port. A port that leaks its adapter's platform
 * into R is not a port: the concrete store provides its own FileSystem, so a
 * consumer of {@link KbStore} needs nothing but the store. `loadEffect` is a
 * value, not a nullary function — an Effect is already the deferred call.
 */
export interface EffectStore {
  readonly path: string;
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;
  commitEffect(tx: StoreTx): Effect.Effect<void, DomainError>;
}
