import { Effect } from "effect";
import type { KbNode } from "./foundation/model.ts";
import type { StoreTx } from "./foundation/tx-validation.ts";
import { bunFileSystemLayer } from "./foundation/platform.ts";
import { kbStoreLayer, type KbContext } from "./foundation/session.ts";
import { openKbEffect } from "./foundation/services.ts";
import { persistEffect, reloadEffect } from "./operations/session.ts";

export type { KbContext } from "./foundation/session.ts";
export {
  KbCtx,
  KbStore,
  kbCtxLayer,
  kbStoreLayer,
} from "./foundation/session.ts";
export { bunFileSystemLayer } from "./foundation/platform.ts";
export {
  jsonlStoreLayer,
  kbRuntimeLayer,
  openKbEffect,
  runWithKb,
} from "./foundation/services.ts";
export { persistEffect, reloadEffect } from "./operations/session.ts";

export async function openKb(root: string): Promise<KbContext> {
  return Effect.runPromise(
    openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer)),
  );
}

export async function reload(ctx: KbContext): Promise<void> {
  return Effect.runPromise(
    reloadEffect(ctx).pipe(
      Effect.provide(kbStoreLayer(ctx.effectStore)),
      Effect.provide(bunFileSystemLayer),
    ),
  );
}

export async function persist(
  ctx: KbContext,
  tx: { upserts: KbNode[]; deletes: string[] } | StoreTx,
): Promise<void> {
  return Effect.runPromise(
    persistEffect(ctx, tx).pipe(
      Effect.provide(kbStoreLayer(ctx.effectStore)),
      Effect.provide(bunFileSystemLayer),
    ),
  );
}
