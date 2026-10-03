import { describe, expect, test } from "bun:test";
import { Duration, Effect } from "effect";
import { ENGINE_LIMITS, runGuest, type SandboxLimits } from "@kb/sandbox";
import { sandboxContract } from "@kb/test-kit";
import { quickjsEngine } from "../src/index.ts";

sandboxContract(quickjsEngine);

function endOfRun(code: string, limits: SandboxLimits) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const guest = yield* runGuest(
          quickjsEngine,
          { code, subject: null, limits },
          {
            draw: () => Effect.void,
            log: () => Effect.void,
            callTool: () => Effect.die("no calls"),
          },
        );
        return yield* guest.ended.pipe(Effect.timeout(Duration.seconds(10)));
      }),
    ),
  );
}

describe("QuickJS", () => {
  test("caps the guest's heap: an allocation past memoryBytes ends the run as out-of-memory", async () => {
    const limits = { ...ENGINE_LIMITS.quickjs, memoryBytes: 8 * 1024 * 1024, turnMs: 5_000 };
    const end = await endOfRun(
      "const a = []; while (true) a.push(new Array(10000).fill(1));",
      limits,
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
