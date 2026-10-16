/**
 * The one rule of a batch's parts (`unloadBrokenBatches`): each is a
 * registered action that is not itself a batch. A plugin breaking it is
 * unloaded as a unit and reported as a failed load; core breaking it dies.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { z } from "zod";
import { ActionPoint, type ExtensionFailure } from "@kb/contracts";
import { definePlugin, makeKernel, type Kernel } from "@kb/plugin";
import { bunFileSystemLayer } from "../src/platform.ts";
import { registryFor, unloadBrokenBatches } from "../src/registry.ts";

/** A plugin in the root namespace contributing `actions`, each `[id, batchOf?]`. */
function plugin(
  name: string,
  actions: ReadonlyArray<readonly [id: string, batchOf?: readonly string[]]>,
) {
  return definePlugin({
    name,
    namespace: "",
    apply: (ctx) =>
      Effect.forEach(
        actions,
        ([id, batchOf]) =>
          ctx.contribute(ActionPoint, {
            id,
            value: {
              title: id,
              description: id,
              mode: { kind: "write" },
              ...(batchOf === undefined ? {} : { batchOf }),
              inputSchema: z.object({}),
              outputSchema: z.object({}),
            },
          }),
        { discard: true },
      ),
  });
}

/** Load `plugins` (the first is core), apply the rule, and report what is left. */
function check(...plugins: ReturnType<typeof plugin>[]) {
  return Effect.gen(function* () {
    const kernel: Kernel = makeKernel();
    const sources = new Map<string, string>();
    const failures: ExtensionFailure[] = [];
    for (const p of plugins) {
      yield* kernel.load(p);
      sources.set(p.name, `${p.name}.ts`);
    }
    const core = plugins[0]?.name ?? "core";
    const exit = yield* Effect.exit(unloadBrokenBatches(kernel, { core, sources, failures }));
    return {
      exit,
      actions: kernel
        .contributions(ActionPoint)
        .map((c) => c.id)
        .toSorted(),
      failures,
    };
  });
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("a batch's parts are registered actions that are not batches", () => {
  test("a batch of a missing action is skipped with its plugin, and reported", async () => {
    const out = await run(
      check(plugin("core", [["p"]]), plugin("x", [["x.ok"], ["x.batch", ["nope"]]])),
    );
    expect(Exit.isSuccess(out.exit)).toBe(true);
    expect(out.actions).toEqual(["p"]);
    expect(out.failures).toEqual([
      { file: "x.ts", error: expect.stringContaining("nope is not registered") },
    ]);
  });

  test("a batch of a batch is refused, and the batch it names stays", async () => {
    const out = await run(
      check(plugin("core", [["p"]]), plugin("y", [["b", ["p"]]]), plugin("x", [["a", ["b"]]])),
    );
    expect(out.actions).toEqual(["b", "p"]);
    expect(out.failures).toEqual([
      { file: "x.ts", error: expect.stringContaining("b is itself a batch") },
    ]);
  });

  test("a chain whose last part is missing loses every plugin on it, and nothing crashes", async () => {
    const out = await run(
      check(plugin("core", [["p"]]), plugin("x", [["a", ["b"]]]), plugin("y", [["b", ["c"]]])),
    );
    expect(Exit.isSuccess(out.exit)).toBe(true);
    expect(out.actions).toEqual(["p"]);
    expect(out.failures.map((f) => f.file).toSorted()).toEqual(["x.ts", "y.ts"]);
  });

  test("a plugin nested under one that is skipped is reported with it", async () => {
    const parent = definePlugin({
      name: "x",
      namespace: "",
      apply: (ctx) =>
        Effect.gen(function* () {
          yield* ctx.plugin(plugin("inner", [["x.inner"]]));
          yield* ctx.contribute(ActionPoint, {
            id: "x.batch",
            value: {
              title: "x.batch",
              description: "x.batch",
              mode: { kind: "write" },
              batchOf: ["nope"],
              inputSchema: z.object({}),
              outputSchema: z.object({}),
            },
          });
        }),
    });
    const out = await run(check(plugin("core", [["p"]]), parent));
    expect(out.actions).toEqual(["p"]);
    expect(out.failures).toEqual([
      { file: "x.ts", error: expect.stringContaining("nope is not registered") },
      { file: "x.ts", error: expect.stringMatching(/^x\/inner unloaded with x: /) },
    ]);
  });

  test("a plugin that will not unload ends the check loudly instead of looping", async () => {
    const kernel = makeKernel();
    const stubborn: Kernel = { ...kernel, unload: () => Effect.void };
    const exit = await run(
      Effect.gen(function* () {
        yield* kernel.load(plugin("core", [["p"]]));
        yield* kernel.load(plugin("x", [["x.batch", ["nope"]]]));
        return yield* Effect.exit(
          unloadBrokenBatches(stubborn, { core: "core", sources: new Map(), failures: [] }),
        );
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("core breaking the rule is a programming error: it dies", async () => {
    const out = await run(check(plugin("core", [["p"], ["batch", ["nope"]]])));
    expect(Exit.isFailure(out.exit)).toBe(true);
  });

  test("core's own batches hold: the registry builds, node.addTree batching node.add", async () => {
    const registry = await Effect.runPromise(
      registryFor(null).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(registry.failures).toEqual([]);
    expect(registry.manifestEntries.find((e) => e.id === "node.addTree")?.batchOf).toEqual([
      { id: "node.add", mode: { kind: "write" } },
    ]);
  });
});
