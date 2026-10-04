import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Point, definePlugin, makeKernel, syncPlugins, type Plugin } from "../src/index.ts";

const Names = Point<string>()("test.names");

/** A plugin contributing its own name, with `child` loaded under it when given. */
function named(name: string, child?: Plugin): Plugin {
  return definePlugin({
    name,
    apply: (ctx) =>
      Effect.gen(function* () {
        yield* ctx.contribute(Names, { id: name, value: name });
        if (child !== undefined) yield* ctx.plugin(child);
      }),
  });
}

const broken = definePlugin({ name: "broken", apply: () => Effect.die(new Error("boom")) });

describe("syncPlugins", () => {
  test("loads what is listed and unloads what is not, with everything it registered", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const kernel = makeKernel();
        expect(yield* syncPlugins(kernel, [named("a"), named("b", named("b-child"))])).toEqual([]);
        expect(kernel.contributions(Names).map(({ value }) => value)).toEqual([
          "a",
          "b",
          "b-child",
        ]);
        expect(yield* syncPlugins(kernel, [named("a")])).toEqual([]);
        expect(kernel.plugins().map(({ name }) => name)).toEqual(["a"]);
        expect(kernel.contributions(Names).map(({ value }) => value)).toEqual(["a"]);
      }),
    ));

  test("a plugin already held is left as it is, so a converged kernel does not move", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const kernel = makeKernel();
        const plugins = [named("a"), named("b")];
        yield* syncPlugins(kernel, plugins);
        const version = kernel.version();
        expect(yield* syncPlugins(kernel, plugins)).toEqual([]);
        expect(kernel.version()).toBe(version);
      }),
    ));

  test("a plugin that fails is returned, and the rest still converge", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const kernel = makeKernel();
        const failures = yield* syncPlugins(kernel, [broken, named("a")]);
        expect(failures.map(({ name, verb }) => ({ name, verb }))).toEqual([
          { name: "broken", verb: "load" },
        ]);
        expect(kernel.contributions(Names).map(({ value }) => value)).toEqual(["a"]);
      }),
    ));
});
