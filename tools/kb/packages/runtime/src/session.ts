import { Effect } from "effect";
import type { KbContext } from "@kb/contracts";
import type { KbNode, StoreTx } from "@kb/model";
import { persistEffect, reloadEffect } from "@kb/operations";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { kbRuntimeLayer, openKbEffect } from "./layers.ts";

/**
 * Promise-shaped session API. The only place that runs a kb Effect against a
 * concrete platform: every caller above this line stays Effect-native.
 */
export async function openKb(root: string): Promise<KbContext> {
  return Effect.runPromise(openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer)));
}

export async function reload(ctx: KbContext): Promise<void> {
  return Effect.runPromise(reloadEffect(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx))));
}

export async function persist(
  ctx: KbContext,
  tx: { upserts: KbNode[]; deletes: string[] } | StoreTx,
): Promise<void> {
  return Effect.runPromise(persistEffect(ctx, tx).pipe(Effect.provide(kbRuntimeLayer(ctx))));
}
