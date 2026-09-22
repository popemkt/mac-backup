/**
 * The JSONL fingerprint is the file's content. These are the edits a stat
 * cannot see; the port-level properties are in the shared store contract.
 */
import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KbNode } from "@kb/model";
import { JsonlStore } from "../src/index.ts";

const AT = "2026-01-01T00:00:00.000Z";
const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "kb-jsonl-mark-"));
  roots.push(root);
  return root;
}

function node(id: string, text: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("a same-size external edit with its mtime restored still moves the fingerprint", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = new JsonlStore(scratch());
      yield* store.commitEffect({ upserts: [node("n-a", "before")], deletes: [] }, { at: AT });
      const before = yield* store.fingerprint;

      const info = statSync(store.path);
      writeFileSync(store.path, readFileSync(store.path, "utf8").replace("before", "after!"));
      utimesSync(store.path, info.atime, info.mtime);

      expect(yield* store.fingerprint).not.toBe(before);
      expect(store.txTail.isCurrent()).toBe(false);
    }),
  ));

test("restoring earlier content restores its fingerprint; a missing file is the empty store", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = new JsonlStore(scratch());
      const empty = yield* store.fingerprint;
      expect(empty).not.toBeNull();

      const first = yield* store.commitEffect(
        { upserts: [node("n-a", "a")], deletes: [] },
        { at: AT },
      );
      expect(first.base).toBe(empty);
      const second = yield* store.commitEffect({ upserts: [], deletes: ["n-a"] }, { at: AT });
      expect(second.base).toBe(first.fingerprint);
      expect(second.fingerprint).toBe(empty);
    }),
  ));
