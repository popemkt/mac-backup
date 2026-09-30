import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Result } from "effect";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { SavedQueries, Assets, LegacyDocsViews, isValidWorkspaceName } from "@kb/contracts";
import {
  assetsLayer,
  legacyDocsViewsLayer,
  readLegacyDocsViews,
  savedQueriesLayer,
} from "../src/index.ts";
import { resolveSavedQueryFile, resolveViewFile } from "../src/paths.ts";

/**
 * The adapter half of the two workspace ports: a name is an id, a bad name
 * never becomes a path, and the ports behave the way the use cases assume.
 *
 * Red case: drop the `rel !== \`${name}${ext}\`` check in `resolveInDir` and
 * `foo/../bar` resolves to a real file again.
 */

function run<A, E>(effect: Effect.Effect<A, E, SavedQueries | Assets>, root: string) {
  const layer = Layer.mergeAll(savedQueriesLayer(root), assetsLayer(root)).pipe(
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
  test("read stays under .kb/queries; a bad name never resolves", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sq-io-"));
    await mkdir(join(root, ".kb", "queries"), { recursive: true });
    await writeFile(join(root, ".kb", "queries", "ok-name.edn"), "[:find ?x]");

    const escaped = await run(
      Effect.gen(function* () {
        const queries = yield* SavedQueries;
        return yield* queries.read("../escape").pipe(Effect.result);
      }),
      root,
    );
    expect(Result.isFailure(escaped)).toBe(true);

    const edn = await run(
      Effect.gen(function* () {
        const queries = yield* SavedQueries;
        return yield* queries.read("ok-name");
      }),
      root,
    );
    expect(edn).toBe("[:find ?x]");

    const missing = await run(
      Effect.gen(function* () {
        const queries = yield* SavedQueries;
        return yield* queries.read("not-there");
      }),
      root,
    );
    expect(missing).toBeNull();
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

/** The legacy docs view specs under `root`, as opening reads them. */
function read(root: string) {
  return Effect.runPromise(readLegacyDocsViews(root).pipe(Effect.provide(BunFileSystem.layer)));
}

describe("legacy docs view specs", () => {
  test("the specs a root keeps are read sorted, a saved query kept, and each one left out named", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-views-"));
    await mkdir(join(root, ".kb", "views"), { recursive: true });
    const spec = {
      output: "docs/x.md",
      query: "[:find ?id :where [?n :node/id ?id]]",
      template: "t",
    };
    await writeFile(join(root, ".kb", "views", "zed.json"), JSON.stringify(spec));
    await writeFile(join(root, ".kb", "views", "abc.json"), JSON.stringify(spec));
    await writeFile(
      join(root, ".kb", "views", "saved.json"),
      '{"output":"o","savedQuery":"q","template":"t"}',
    );
    await writeFile(join(root, ".kb", "views", "broken.json"), "{");
    await writeFile(
      join(root, ".kb", "views", "both.json"),
      '{"output":"o","query":"q","savedQuery":"q","template":"t"}',
    );

    expect(await read(root)).toEqual({
      views: [
        { name: "abc", spec },
        { name: "saved", spec: { output: "o", savedQuery: "q", template: "t" } },
        { name: "zed", spec },
      ],
      skipped: [
        ".kb/views/both.json was not imported: it names both a query and a saved query, or neither",
        ".kb/views/broken.json was not imported: it is not a spec kb can read",
      ],
    });
    expect(await read(await mkdtemp(join(tmpdir(), "kb-no-views-")))).toEqual({
      views: [],
      skipped: [],
    });
  });

  test("retire removes the imported files, and the directory once it is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-views-"));
    await mkdir(join(root, ".kb", "views"), { recursive: true });
    await writeFile(join(root, ".kb", "views", "a.json"), "{}");
    await writeFile(join(root, ".kb", "views", "b.json"), "{}");
    const retire = (names: string[]) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const legacy = yield* LegacyDocsViews;
          yield* legacy.retire(names);
        }).pipe(
          Effect.provide(legacyDocsViewsLayer(root).pipe(Layer.provide(BunFileSystem.layer))),
        ),
      );
    await retire(["a"]);
    expect(await readdir(join(root, ".kb", "views"))).toEqual(["b.json"]);
    await retire(["b"]);
    expect(await readdir(join(root, ".kb"))).toEqual([]);
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
