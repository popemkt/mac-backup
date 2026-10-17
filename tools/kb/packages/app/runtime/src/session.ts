import { Effect } from "effect";
import type { KbContext } from "@kb/contracts";
import { reloadEffect } from "@kb/operations";
import { bunFileSystemLayer } from "./platform.ts";
import { kbRuntimeLayer } from "./layers.ts";
import { openKbEffect } from "./open.ts";

/**
 * Promise-shaped session API. The only place that runs a kb Effect against a
 * concrete platform: every caller above this line stays Effect-native.
 */
export function openKb(root: string): Promise<KbContext> {
  return Effect.runPromise(openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer)));
}

export function reload(ctx: KbContext): Promise<void> {
  return Effect.runPromise(reloadEffect(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx))));
}
