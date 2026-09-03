import { Context, Layer } from "effect";
import type { KbNode } from "./model.ts";
import type { QueryDb } from "./query/index.ts";
import type { EffectStore, Store } from "./storage/store.ts";

/**
 * Mutable kb session state. Surfaces still pass this object; Effect programs
 * receive it via {@link KbCtx}.
 */
export interface KbContext {
  root: string;
  /** Promise Store facade (tests / legacy). Effect code uses {@link KbStore}. */
  store: Store;
  /** Effect-native store instance (same JsonlStore as `store` when live). */
  effectStore: EffectStore;
  nodes: KbNode[];
  qdb: QueryDb;
}

/**
 * Effect-native Store port. Live consumers: `reloadEffect` / `persistEffect`
 * (yield* KbStore → loadEffect/commitEffect).
 */
export class KbStore extends Context.Service<KbStore, EffectStore>()(
  "kb/KbStore",
) {}

/** Live kb session (nodes + qdb + store). */
export class KbCtx extends Context.Service<KbCtx, KbContext>()("kb/KbCtx") {}

export function kbStoreLayer(store: EffectStore): Layer.Layer<KbStore> {
  return Layer.succeed(KbStore, store);
}

export function kbCtxLayer(ctx: KbContext): Layer.Layer<KbCtx> {
  return Layer.succeed(KbCtx, ctx);
}
