/**
 * `.kb/trust.json`: trust is kept per digest and per machine, beside the
 * store and never in it, and a file kb did not write trusts nothing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { Effect, Layer } from "effect";
import { CodeTrust } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { codeTrustLayer } from "../src/index.ts";

const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-trust-"));
  await mkdir(join(root, ".kb"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function on<A>(
  machine: string,
  use: (trust: CodeTrust["Service"]) => Effect.Effect<A, DomainError>,
) {
  const layer = codeTrustLayer(root, machine).pipe(Layer.provide(BunFileSystem.layer));
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* CodeTrust);
    }).pipe(Effect.provide(layer)) as Effect.Effect<A>,
  );
}

describe("code trust on disk", () => {
  test("trusts a digest on this machine, and only that digest", async () => {
    expect(await on("mac-1", (t) => t.trusted([A, B]))).toEqual([]);
    await on("mac-1", (t) => t.trust(A));
    await on("mac-1", (t) => t.trust(A));
    expect(await on("mac-1", (t) => t.trusted([A, B]))).toEqual([A]);
    const file = JSON.parse(await readFile(join(root, ".kb", "trust.json"), "utf8")) as {
      trusted: unknown[];
    };
    expect(file.trusted).toHaveLength(1);
  });

  test("a record made on another machine trusts nothing here", async () => {
    await on("mac-1", (t) => t.trust(A));
    expect(await on("mac-2", (t) => t.trusted([A]))).toEqual([]);
  });

  test("untrusting drops this machine's record alone", async () => {
    await on("mac-1", (t) => t.trust(A));
    await on("mac-2", (t) => t.trust(A));
    await on("mac-1", (t) => t.untrust(A));
    expect(await on("mac-1", (t) => t.trusted([A]))).toEqual([]);
    expect(await on("mac-2", (t) => t.trusted([A]))).toEqual([A]);
  });

  test("a file kb did not write trusts nothing", async () => {
    await writeFile(join(root, ".kb", "trust.json"), '{"trusted": ["everything"]}');
    expect(await on("mac-1", (t) => t.trusted([A]))).toEqual([]);
  });
});
