/**
 * A snapshot of a run that ends while it starts: QuickJS runs the code's
 * first turn inside `start`, so a loop is interrupted before the snapshot
 * waits at all. The run's end reaches its driver only once the guest's last
 * messages have drained, and a run that is over is not quiet: it settles
 * when its end is known, so the snapshot says how it ended. The engine here
 * is a stand-in whose end answers only after the scheduler has had many
 * turns, which is the order a slow machine can take.
 */
import { describe, expect, test } from "bun:test";
import { type Cause, Effect, Queue } from "effect";
import { snapshotRun, type GuestEnd, type SandboxEngine } from "../src/index.ts";

const END: GuestEnd = { reason: "interrupted", message: "The code ran too long." };

/** An engine whose run is already over when `start` returns, its end slow to be told. */
const endedAtStart: SandboxEngine = {
  kind: "quickjs",
  start: () =>
    Effect.gen(function* () {
      const outbox = yield* Queue.unbounded<string, Cause.Done>();
      Queue.endUnsafe(outbox);
      return {
        deliver: () => Effect.void,
        outbox,
        ended: Effect.gen(function* () {
          for (let turn = 0; turn < 50; turn++) yield* Effect.yieldNow;
          return END;
        }),
        over: () => true,
        stop: Effect.void,
      };
    }),
};

describe("a snapshot", () => {
  test("of a run that ended while it started says how it ended", async () => {
    const snapshot = await Effect.runPromise(
      snapshotRun(
        endedAtStart,
        { invoke: () => Effect.die("no calls") },
        { code: "while (true) {}", grant: { reads: "none", actions: [] }, subject: null },
      ),
    );
    expect(snapshot).toEqual({ html: null, end: END });
  });
});
