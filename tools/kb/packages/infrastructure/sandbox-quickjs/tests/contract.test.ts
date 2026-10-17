import { describe, expect, test } from "bun:test";
import { Clock, Duration, Effect } from "effect";
import { ENGINE_LIMITS, runGuest, type SandboxLimits } from "@kb/sandbox";
import { sandboxContract } from "@kb/test-kit";
import { quickjsEngine } from "../src/index.ts";

sandboxContract(quickjsEngine);

/**
 * The clock with its time standing still: a turn never outlives `turnMs` on
 * it, so a run can end only by what the case is about. Sleeping stays real.
 */
const timeStandsStill = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const still: Clock.Clock = {
    currentTimeMillisUnsafe: () => 0,
    currentTimeMillis: Effect.succeed(0),
    currentTimeNanosUnsafe: () => 0n,
    currentTimeNanos: Effect.succeed(0n),
    monotonicTimeNanosUnsafe: () => 0n,
    monotonicTimeNanos: Effect.succeed(0n),
    sleep: (duration) => clock.sleep(duration),
  };
  return still;
});

/** The clock as it is. */
const timeRuns = Effect.gen(function* () {
  return yield* Clock.Clock;
});

function endOfRun(code: string, limits: SandboxLimits, clock = timeRuns) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const guest = yield* runGuest(
          quickjsEngine,
          { code, subject: null, events: [], limits },
          {
            draw: () => Effect.void,
            log: () => Effect.void,
            callTool: () => Effect.die("no calls"),
          },
        );
        return yield* guest.ended.pipe(Effect.timeout(Duration.seconds(10)));
      }).pipe(Effect.provideServiceEffect(Clock.Clock, clock)),
    ),
  );
}

describe("QuickJS", () => {
  test("caps the guest's heap: an allocation past memoryBytes ends the run as out-of-memory", async () => {
    // However slowly the allocations run, the turn's time never runs out:
    // only the heap can end this run.
    const limits = { ...ENGINE_LIMITS.quickjs, memoryBytes: 8 * 1024 * 1024 };
    const end = await endOfRun(
      "const a = []; while (true) a.push(new Array(10000).fill(1));",
      limits,
      timeStandsStill,
    );
    expect(end.reason).toBe("out-of-memory");
    expect(end.message).toContain("8 MB");
  });

  test("caps the guest's stack", async () => {
    const end = await endOfRun("function f() { return f() + 1; } f();", ENGINE_LIMITS.quickjs);
    expect(end.reason).toBe("error");
    expect(end.message).toContain("stack overflow");
  });
});
