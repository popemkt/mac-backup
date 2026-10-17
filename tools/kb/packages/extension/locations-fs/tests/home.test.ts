/** Where the home store lives: `KB_HOME` when set, else the platform's place for app data. */
import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigProvider, Effect } from "effect";
import { resolveHomeEffect } from "../src/home.ts";

const homeWith = (env: Record<string, string>) =>
  Effect.runPromise(
    resolveHomeEffect().pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
    ),
  );

describe("the home store's place", () => {
  test("KB_HOME names it, resolved to an absolute path", async () => {
    expect(await homeWith({ KB_HOME: "/tmp/somewhere/home" })).toBe("/tmp/somewhere/home");
    expect(await homeWith({ KB_HOME: "relative" })).toBe(join(process.cwd(), "relative"));
  });

  test("unset, it is the platform's application data place", async () => {
    const expected =
      process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support", "kb", "home")
        : join("/data", "kb", "home");
    expect(await homeWith({ XDG_DATA_HOME: "/data" })).toBe(expected);
  });
});
