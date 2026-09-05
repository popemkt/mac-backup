import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Result } from "effect";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { SavedQueries, Views, Assets, isValidWorkspaceName } from "@kb/contracts";
import { assetsLayer, savedQueriesLayer, viewsLayer } from "../src/index.ts";
import { resolveSavedQueryFile, resolveViewFile } from "../src/paths.ts";

/**
 * The adapter half of the three workspace ports: a name is an id, a bad name
 * never becomes a path, and the ports behave the way the use cases assume.
 *
 * Red case: drop the `rel !== \`${name}${ext}\`` check in `resolveInDir` and
 * `foo/../bar` resolves to a real file again.
 */

function run<A, E>(effect: Effect.Effect<A, E, SavedQueries | Views | Assets>, root: string) {
  const layer = Layer.mergeAll(savedQueriesLayer(root), viewsLayer(root), assetsLayer(root)).pipe(
    Layer.provide(BunFileSystem.layer),
  );
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

const BAD_NAMES = [
  "",
  ".",
  "..",
  "../x",
  "a/b",
  "a\\b",
  "has space",
  "-leading",
  ".dot",
  "a\nb",
  "a\0b",
  "foo/../bar",
];

describe("workspace name resolution", () => {
  test("accepts the compatibility names kb run and views have always taken", () => {
    for (const name of ["all-text", "todos", "a", "foo.bar", "X_1-2"]) {
      expect(isValidWorkspaceName(name)).toBe(true);
      expect(resolveSavedQueryFile("/tmp/kb-root", name)).toBe(
        join("/tmp/kb-root", ".kb", "queries", `${name}.edn`),
      );
      expect(resolveViewFile("/tmp/kb-root", name)).toBe(
        join("/tmp/kb-root", ".kb", "views", `${name}.json`),
      );
    }
  });

  test("rejects traversal, control, ambiguous, and empty names", () => {
    for (const name of BAD_NAMES) {
      expect(isValidWorkspaceName(name)).toBe(false);
      expect(resolveSavedQueryFile("/tmp/kb-root", name)).toBeNull();
      expect(resolveViewFile("/tmp/kb-root", name)).toBeNull();
    }
  });
});

describe("SavedQueries port", () => {
  test("write/read/remove stay under .kb/queries; a bad name never lands", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sq-io-"));

    const escaped = await run(
      Effect.gen(function* () {
        const queries = yield* SavedQueries;
        return yield* queries.write("../escape", "[:find ?x]").pipe(Effect.result);
      }),
      root,
    );
    expect(Result.isFailure(escaped)).toBe(true);

    const edn = await run(
      Effect.gen(function* () {
        const queries = yield* SavedQueries;
        yield* queries.write("ok-name", "[:find ?x]");
        return yield* queries.read("ok-name");
      }),
      root,
    );
    expect(edn).toBe("[:find ?x]");
    expect(await readFile(join(root, ".kb", "queries", "ok-name.edn"), "utf8")).toBe("[:find ?x]");

    const after = await run(
      Effect.gen(function* () {
        const queries = yield* SavedQueries;
        // Removing twice is the same as removing once.
        yield* queries.remove("ok-name");
        yield* queries.remove("ok-name");
        return yield* queries.read("ok-name");
      }),
      root,
    );
    expect(after).toBeNull();
  });

  test("list skips stems the port could never address", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sq-list-"));
    await mkdir(join(root, ".kb", "queries", "dir.edn"), { recursive: true });
    await writeFile(join(root, ".kb", "queries", "good.edn"), "[:find ?g]");
    await writeFile(join(root, ".kb", "queries", "has space.edn"), "[:find ?b]");
    await writeFile(join(root, ".kb", "queries", "-bad.edn"), "[:find ?b]");
    await writeFile(join(root, ".kb", "queries", ".dot.edn"), "[:find ?d]");

    const listed = await run(
      Effect.gen(function* () {
        const queries = yield* SavedQueries;
        return yield* queries.list;
      }),
      root,
    );
    expect(listed.map((q) => q.name)).toEqual(["good"]);
  });
});

describe("Views port", () => {
  test("list is sorted; load returns source text or null", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-views-"));
    await mkdir(join(root, ".kb", "views"), { recursive: true });
    await writeFile(join(root, ".kb", "views", "zed.json"), "{}");
    await writeFile(join(root, ".kb", "views", "abc.json"), '{"a":1}');

    const [names, abc, missing] = await run(
      Effect.gen(function* () {
        const views = yield* Views;
        return [yield* views.list, yield* views.load("abc"), yield* views.load("nope")] as const;
      }),
      root,
    );
    expect(names).toEqual(["abc", "zed"]);
    expect(abc).toBe('{"a":1}');
    expect(missing).toBeNull();
  });
});

describe("Assets port", () => {
  test("write returns the markdown path and puts the bytes under .kb/assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-assets-"));
    const path = await run(
      Effect.gen(function* () {
        const assets = yield* Assets;
        return yield* assets.write("01ABC", "png", new Uint8Array([1, 2, 3]));
      }),
      root,
    );
    expect(path).toBe("assets/01ABC.png");
    expect(await readFile(join(root, ".kb", "assets", "01ABC.png"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
  });

  test("an id that would escape the assets dir is refused", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-assets-esc-"));
    const result = await run(
      Effect.gen(function* () {
        const assets = yield* Assets;
        return yield* assets.write("../escape", "png", new Uint8Array([1])).pipe(Effect.result);
      }),
      root,
    );
    expect(Result.isFailure(result)).toBe(true);
  });
});
