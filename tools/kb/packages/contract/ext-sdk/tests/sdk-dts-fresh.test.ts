import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { KB_SDK_DTS, KB_SDK_VERSION } from "../src/sdk-dts.text.ts";
import { generateExtSdkDts } from "../scripts/generate.ts";

/**
 * `src/sdk-dts.text.ts` is generated from `src/surface.ts`; this asserts the
 * committed copy is what the generator emits today. It lives here, next to
 * both files, rather than in @kb/cli's suite: the generator left the package
 * surface when it moved to `scripts/`, and only this package can reach it.
 */
describe("extension SDK freshness", () => {
  test("committed KB_SDK_DTS matches regeneration from surface.ts", async () => {
    const { dts, version } = await Effect.runPromise(
      Effect.scoped(generateExtSdkDts()).pipe(Effect.provide(BunFileSystem.layer)),
    );
    expect(version).toBe(KB_SDK_VERSION);
    expect(dts).toBe(KB_SDK_DTS);
  });
});
