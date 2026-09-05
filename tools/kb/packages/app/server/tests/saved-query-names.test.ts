import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSavedQueries } from "../src/saved-queries.ts";

/**
 * `GET /api/queries` over the SavedQueries port. What a name may be, and what
 * a name resolves to, are the port's own tests
 * (packages/infrastructure/workspace-fs/tests); this file asserts the promise
 * the HTTP surface makes on top of it — that a hostile `.kb/queries` cannot
 * take the endpoint down.
 */
describe("GET /api/queries listing", () => {
  test("skips invalid stems; keeps valid ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sq-list-"));
    await mkdir(join(root, ".kb", "queries"), { recursive: true });
    await writeFile(join(root, ".kb", "queries", "good.edn"), "[:find ?g]");
    await writeFile(join(root, ".kb", "queries", "has space.edn"), "[:find ?b]");
    await writeFile(join(root, ".kb", "queries", "-bad.edn"), "[:find ?b]");
    await writeFile(join(root, ".kb", "queries", ".dot.edn"), "[:find ?d]");

    const listed = await listSavedQueries(root);
    expect(listed.map((q) => q.name)).toEqual(["good"]);
  });

  test("skips non-regular entries named *.edn", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sq-dir-"));
    await mkdir(join(root, ".kb", "queries", "dir.edn"), { recursive: true });
    await writeFile(join(root, ".kb", "queries", "good.edn"), "[:find ?g]");

    const listed = await listSavedQueries(root);
    expect(listed.map((q) => q.name)).toEqual(["good"]);
  });

  test("a missing queries directory lists nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-sq-none-"));
    expect(await listSavedQueries(root)).toEqual([]);
  });
});
