import { Effect } from "effect";
import type { KbNode } from "./foundation/model.ts";
import type { StoreTx } from "./foundation/storage/index.ts";
import {
  bunFileSystemLayer,
  kbStoreLayer,
  openKbEffect,
  persistEffect,
  reloadEffect,
  type KbContext,
} from "./foundation/services.ts";

export type { KbContext } from "./foundation/services.ts";
export {
  KbCtx,
  KbStore,
  bunFileSystemLayer,
  jsonlStoreLayer,
  kbCtxLayer,
  kbRuntimeLayer,
  kbStoreLayer,
  openKbEffect,
  persistEffect,
  reloadEffect,
  runWithKb,
} from "./foundation/services.ts";

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
