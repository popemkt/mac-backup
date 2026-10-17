import { Effect, Layer } from "effect";
import { GraphWrites, KbCtx, KbStore } from "@kb/contracts";
import { persistPlannedEffect } from "./session.ts";

/**
 * Core's write path as the `GraphWrites` port, over the session and store
 * the layer is given: `commit` is `persistPlannedEffect`. What a commit is asked
 * about — the running call, its origin, the clock — is read where the
 * returned effect runs, so a family's write is decided and recorded as part
 * of the call that makes it.
 */
export const graphWritesLayer: Layer.Layer<GraphWrites, never, KbCtx | KbStore> = Layer.effect(
  GraphWrites,
  Effect.gen(function* () {
    const ctx = yield* KbCtx;
    const store = yield* KbStore;
    return GraphWrites.of({
      commit: (plan) => persistPlannedEffect(ctx, plan).pipe(Effect.provideService(KbStore, store)),
    });
  }),
);
