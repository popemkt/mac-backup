/**
 * The secret source `kb ui` binds (DESIGN.md → Data model → a secret is a
 * reference): `env:` reads this process's environment, `keychain:` asks the
 * platform's keychain, and a reference that does not resolve fails naming
 * what it refers to, never a value.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { SecretRef } from "@kb/model";
import { systemSecrets, type LookupResult } from "../src/index.ts";

const notFound = (): Promise<LookupResult> => Promise.resolve({ code: 44, stdout: "" });

function resolve(source: ReturnType<typeof systemSecrets>, ref: SecretRef) {
  return Effect.runPromise(Effect.result(source.resolve(ref)));
}

describe("systemSecrets", () => {
  test("a keychain that never answers is given up, its lookup aborted, naming the item", async () => {
    const signals: AbortSignal[] = [];
    const hangs = (_argv: readonly string[], signal: AbortSignal): Promise<LookupResult> => {
      signals.push(signal);
      return new Promise(() => undefined);
    };
    const source = systemSecrets({ platform: "darwin", run: hangs, timeoutMs: 20 });
    expect(await resolve(source, { kind: "keychain", service: "kb-proxy" })).toMatchObject({
      failure: { message: "the keychain item kb-proxy: security did not answer within 0.02s" },
    });
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
  });

  test("env: reads the named variable; unset or empty fails naming it", async () => {
    const source = systemSecrets({ env: { KEY: "sk-1", EMPTY: "" } });
    expect(await resolve(source, { kind: "env", name: "KEY" })).toMatchObject({ success: "sk-1" });
    for (const name of ["MISSING", "EMPTY"]) {
      expect(await resolve(source, { kind: "env", name })).toMatchObject({
        failure: { message: `the environment variable ${name} is not set` },
      });
    }
  });

  test("keychain: asks security on macOS and secret-tool on Linux, and trims the newline", async () => {
    const asked: (readonly string[])[] = [];
    const run = (argv: readonly string[], _signal: AbortSignal): Promise<LookupResult> => {
      asked.push(argv);
      return Promise.resolve({ code: 0, stdout: "sk-2\n" });
    };
    const ref: SecretRef = { kind: "keychain", service: "kb-proxy", account: "me" };
    for (const platform of ["darwin", "linux"]) {
      expect(await resolve(systemSecrets({ platform, run }), ref)).toMatchObject({
        success: "sk-2",
      });
    }
    expect(asked).toEqual([
      ["security", "find-generic-password", "-s", "kb-proxy", "-a", "me", "-w"],
      ["secret-tool", "lookup", "service", "kb-proxy", "account", "me"],
    ]);
  });

  test("a keychain item not found, or a platform with no keychain kb reads, fails naming the item", async () => {
    const ref: SecretRef = { kind: "keychain", service: "kb-proxy" };
    expect(await resolve(systemSecrets({ platform: "darwin", run: notFound }), ref)).toMatchObject({
      failure: { message: "the keychain item kb-proxy is not set" },
    });
    expect(await resolve(systemSecrets({ platform: "win32", run: notFound }), ref)).toMatchObject({
      failure: { message: "the keychain item kb-proxy: kb reads no keychain on win32" },
    });
  });
});
