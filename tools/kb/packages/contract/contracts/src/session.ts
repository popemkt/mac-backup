import { Context, Layer } from "effect";
import type { KbNode } from "@kb/model";
import type { KbIndex } from "@kb/query";
import type { EffectStore } from "./store.ts";
import type { KbTxLog } from "./tx-log.ts";

/**
 * Mutable kb session state. Surfaces still pass this object; Effect programs
 * receive it via {@link KbCtx}.
 */
export interface KbContext {
  root: string;
  /** The session's one persistence capability. */
  store: EffectStore;
  /** The one owner of the derived graph: datoms, node lookup, text scan. */
  index: KbIndex;
  /** The one record of what this session's store has committed, in order. */
  log: KbTxLog;
  /**
   * The stored nodes, derived from {@link index}. Read-only on purpose: the
   * index owns the node set, and a session that could assign here would be a
   * second owner drifting from the datoms it is supposed to describe.
   */
  readonly nodes: KbNode[];
}

/**
 * Effect-native store port. Live consumers: `reloadEffect` / `persistEffect`
 * (yield* KbStore → loadEffect/commitEffect).
 */
export class KbStore extends Context.Service<KbStore, EffectStore>()("kb/KbStore") {}

/** Live kb session (store + index). */
export class KbCtx extends Context.Service<KbCtx, KbContext>()("kb/KbCtx") {}

export function kbStoreLayer(store: EffectStore): Layer.Layer<KbStore> {
  return Layer.succeed(KbStore, store);
}

export function kbCtxLayer(ctx: KbContext): Layer.Layer<KbCtx> {
  return Layer.succeed(KbCtx, ctx);
}
