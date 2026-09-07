/**
 * What an interactive edit costs the index.
 *
 * Before the port there were three full index builds behind one UI edit: the
 * reload the HTTP path did before every action, the rebuild persist did after
 * committing, and the rebuild the hub did when it broadcast. All three are now
 * one incremental transaction plus a staleness check that knows this session
 * wrote the file, so the number to assert is zero.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { openKb, kbRuntimeLayer } from "@kb/runtime";
import { reloadEffect } from "@kb/operations";
import { JsonlStore } from "@kb/store-jsonl";
import { ingestExternalWrite } from "../src/server.ts";
import { DatascriptIndex, type KbIndex } from "@kb/query";
import type { KbNode } from "@kb/model";
import { handleHttpRequest } from "../src/http.ts";
import { SubscriptionHub } from "../src/session.ts";

/** The `at` a test commit records; the tail wants one and none of these assert on it. */
const TX_AT = "2026-01-01T00:00:00.000Z";

/** The counter lives on the implementation; the port does not promise one. */
function rebuildsOf(index: KbIndex): number {
  if (!(index instanceof DatascriptIndex)) throw new Error("expected a DatascriptIndex");
  return index.rebuilds;
}

function node(id: string, text = id): KbNode {
  return {
    id,
    text,
    props: {},
    children: [],
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kb-rebuilds-"));
  await mkdir(join(dir, ".kb"), { recursive: true });
  return dir;
}

describe("index rebuilds on the interactive path", () => {
  test("one edit through /api/action performs zero full rebuilds", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const deps = { root: dir, ctx, hub };
      const before = rebuildsOf(ctx.index);

      const res = await handleHttpRequest(
        new Request("http://127.0.0.1/api/action", {
          method: "POST",
          body: JSON.stringify({ id: "node.add", input: { text: "edited", id: "n.edit" } }),
        }),
        deps,
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe("succeeded");

      expect(ctx.index.getNode("n.edit")?.text).toBe("edited");
      expect(rebuildsOf(ctx.index)).toBe(before);

      // …and the watcher firing on the write this session just made adds
      // none: the store file is the one the session last wrote, so the ingest
      // diff is empty and appends no second transaction for the same edit.
      const revAfterAction = ctx.log.head;
      await Effect.runPromise(
        ingestExternalWrite(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx))) as Effect.Effect<void>,
      );
      expect(rebuildsOf(ctx.index)).toBe(before);
      expect(ctx.log.head).toBe(revAfterAction);
      expect(ctx.index.getNode("n.edit")?.text).toBe("edited");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a write from another process is picked up, and costs one rebuild", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const before = rebuildsOf(ctx.index);

      const external = new JsonlStore(dir);
      const onDisk = await Effect.runPromise(external.loadEffect);
      await Effect.runPromise(
        external.commitEffect(
          { upserts: [...onDisk, node("n.external")], deletes: [] },
          { at: TX_AT },
        ),
      );

      await Effect.runPromise(
        reloadEffect(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx))) as Effect.Effect<void>,
      );
      expect(ctx.index.getNode("n.external")).toBeDefined();
      expect(rebuildsOf(ctx.index)).toBe(before + 1);

      // A second reload with nothing new does not build again.
      await Effect.runPromise(
        reloadEffect(ctx).pipe(Effect.provide(kbRuntimeLayer(ctx))) as Effect.Effect<void>,
      );
      expect(rebuildsOf(ctx.index)).toBe(before + 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
