import { describe, expect, test } from "bun:test";
import { present } from "@kb/model";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteSavedQuery,
  isValidSavedQueryName,
  readSavedQuery,
  resolveSavedQueryFile,
  saveSavedQuery,
} from "@kb/operations";
import { Effect } from "effect";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { listSavedQueries } from "../src/saved-queries.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(bunFileSystemLayer)) as Effect.Effect<A, E>);

describe("saved-query name validation", () => {
  test("accepts compatibility names used by kb run / views", () => {
    for (const name of ["all-text", "todos", "a", "foo.bar", "X_1-2"]) {
      expect(isValidSavedQueryName(name)).toBe(true);
    }
  });

  test("rejects traversal, control, ambiguous, and empty names", () => {
    for (const name of [
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
    ]) {
      expect(isValidSavedQueryName(name)).toBe(false);
      expect(resolveSavedQueryFile("/tmp/kb-root", name)).toBeNull();
    }
  });

  test("resolve/save/read/delete stay under .kb/queries", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sq-io-"));
    const path = resolveSavedQueryFile(root, "ok-name");
    expect(path).toBe(join(root, ".kb", "queries", "ok-name.edn"));

    expect(await run(saveSavedQuery(root, "../escape", "[:find ?x]"))).toBe(false);
    expect(await run(saveSavedQuery(root, "ok-name", "[:find ?x]"))).toBe(true);
    expect(await readFile(present(path, "expected path"), "utf8")).toBe("[:find ?x]");
    expect(await run(readSavedQuery(root, "ok-name"))).toBe("[:find ?x]");
    expect(await run(readSavedQuery(root, "../escape"))).toBeNull();
    expect(await run(deleteSavedQuery(root, "../escape"))).toBe(false);
    expect(await run(deleteSavedQuery(root, "ok-name"))).toBe(true);
    expect(await run(readSavedQuery(root, "ok-name"))).toBeNull();
  });

  test("listSavedQueries skips invalid stems; keeps valid ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sq-list-"));
    await mkdir(join(root, ".kb", "queries"), { recursive: true });
    await writeFile(join(root, ".kb", "queries", "good.edn"), "[:find ?g]");
    await writeFile(join(root, ".kb", "queries", "has space.edn"), "[:find ?b]");
    await writeFile(join(root, ".kb", "queries", "-bad.edn"), "[:find ?b]");
    await writeFile(join(root, ".kb", "queries", ".dot.edn"), "[:find ?d]");

    const listed = await listSavedQueries(root);
    expect(listed.map((q) => q.name)).toEqual(["good"]);
  });

  test("listSavedQueries skips non-regular entries named *.edn", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sq-dir-"));
    await mkdir(join(root, ".kb", "queries", "dir.edn"), { recursive: true });
    await writeFile(join(root, ".kb", "queries", "good.edn"), "[:find ?g]");

    const listed = await listSavedQueries(root);
    expect(listed.map((q) => q.name)).toEqual(["good"]);
  });
});
