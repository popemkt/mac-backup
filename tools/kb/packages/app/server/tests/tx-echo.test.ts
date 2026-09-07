/**
 * The echo, end to end: one write, one logged transaction, one frame per
 * watcher — the client that caused it included.
 *
 * Suppressing the origin's own frame was the bug this replaces. Its rev stayed
 * one behind after every self-write, so the next foreign tx arrived as a gap
 * and cost a full `/api/graph` refetch. The red case for that is the last test
 * here: two writes from two clients, and neither client ever sees a
 * non-contiguous rev.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { openKb, kbRuntimeLayer } from "@kb/runtime";
import { JsonlStore } from "@kb/store-jsonl";
import type { ServerMessage } from "@kb/contracts";
import { diffTx, type KbNode } from "@kb/model";
import { handleHttpRequest } from "../src/http.ts";
import { ingestExternalWrite } from "../src/server.ts";
import { SubscriptionHub } from "../src/session.ts";

/** The `at` a test commit records; the tail wants one and none of these assert on it. */
const TX_AT = "2026-01-01T00:00:00.000Z";

type TxFrame = Extract<ServerMessage, { op: "tx" }>;

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kb-tx-echo-"));
  await mkdir(join(dir, ".kb"), { recursive: true });
  return dir;
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

/** A watching client: collects frames, opted into tx broadcasts. */
async function watcher(hub: SubscriptionHub, id: string): Promise<unknown[]> {
  const frames: unknown[] = [];
  await Effect.runPromise(
    hub.addClient(id, (text) =>
      Effect.sync(() => {
        frames.push(JSON.parse(text));
      }),
    ),
  );
  await Effect.runPromise(hub.handleMessage(id, JSON.stringify({ op: "watch-tx", enabled: true })));
  return frames;
}

function txFrames(frames: unknown[]): TxFrame[] {
  return frames.filter((f): f is TxFrame => (f as { op: string }).op === "tx");
}

/** What a client does with a `tx` frame, in node terms. */
function apply(nodes: KbNode[], frame: TxFrame | undefined): KbNode[] {
  const next = new Map(nodes.map((n) => [n.id, n]));
  for (const id of frame?.deletes ?? []) next.delete(id);
  for (const n of frame?.upserts ?? []) next.set(n.id, n);
  return [...next.values()].toSorted((x, y) => (x.id < y.id ? -1 : 1));
}

function addNode(
  deps: Parameters<typeof handleHttpRequest>[1],
  id: string,
  origin?: string,
): Promise<Response> {
  return handleHttpRequest(
    new Request("http://127.0.0.1/api/action", {
      method: "POST",
      headers: origin === undefined ? {} : { "x-kb-origin": origin },
      body: JSON.stringify({ id: "node.add", input: { text: id, id } }),
    }),
    deps,
  );
}

describe("the server echoes every tx to every watcher", () => {
  test("both clients see the same rev, the origin included", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const deps = { root: dir, ctx, hub };
      const a = await watcher(hub, "client-a");
      const b = await watcher(hub, "client-b");

      const res = await addNode(deps, "n.one", "client-a");
      expect(res.status).toBe(200);

      const [aTx] = txFrames(a);
      const [bTx] = txFrames(b);
      expect(aTx).toBeDefined();
      expect(aTx).toEqual(bTx as TxFrame);
      expect(aTx?.rev).toBe(ctx.log.head);
      expect(aTx?.upserts.map((n) => n.id)).toEqual(["n.one"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the echo converges the origin's optimistic state, and replays as a no-op", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const deps = { root: dir, ctx, hub };
      const a = await watcher(hub, "client-a");

      // The optimistic apply the origin made before the request went out.
      // Its timestamps are its own guess; the entity is the same entity.
      const optimistic = [...ctx.index.storedNodes(), node("n.opt", "n.opt")];

      await addNode(deps, "n.opt", "client-a");
      const [frame] = txFrames(a);
      expect(frame).toBeDefined();

      // The confirming frame is keyed by node id, so it replaces the guess
      // rather than landing beside it: the origin converges on the server's
      // node set instead of holding two of anything.
      const once = apply(optimistic, frame);
      expect(once.map((n) => n.id)).toEqual(
        ctx.index
          .storedNodes()
          .map((n) => n.id)
          .toSorted(),
      );
      expect(diffTx(once, ctx.index.storedNodes())).toEqual({ upserts: [], deletes: [] });

      // …and a redelivery of the same frame changes nothing at all.
      expect(diffTx(once, apply(once, frame))).toEqual({ upserts: [], deletes: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("two clients writing in turn never see a rev gap", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const deps = { root: dir, ctx, hub };
      const a = await watcher(hub, "client-a");
      const b = await watcher(hub, "client-b");

      await addNode(deps, "n.a", "client-a");
      await addNode(deps, "n.b", "client-b");

      const revs = (frames: unknown[]): number[] => txFrames(frames).map((f) => f.rev);
      const expected = [ctx.log.head - 1, ctx.log.head];
      expect(revs(a)).toEqual(expected);
      expect(revs(b)).toEqual(expected);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an external write is one appended tx; a re-ingest of the same file is none", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const a = await watcher(hub, "client-a");

      // A second store over the same files is another process: it commits its
      // own delta, which lands in the shared tail with it.
      const external = new JsonlStore(dir);
      await Effect.runPromise(
        external.commitEffect({ upserts: [node("n.external")], deletes: [] }, { at: TX_AT }),
      );

      const before = ctx.log.head;
      const ingest = ingestExternalWrite(ctx).pipe(
        Effect.provide(kbRuntimeLayer(ctx)),
      ) as Effect.Effect<void>;
      await Effect.runPromise(ingest);
      expect(ctx.log.head).toBe(before + 1);
      expect(
        txFrames(a)
          .at(-1)
          ?.upserts.map((n) => n.id),
      ).toEqual(["n.external"]);

      // The watcher double-fires on the same file. The tail has nothing past
      // head and the node sets agree, so no rev is spent and no frame is sent.
      await Effect.runPromise(ingest);
      expect(ctx.log.head).toBe(before + 1);
      expect(txFrames(a)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("since replies with the frames after a rev, in order", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const deps = { root: dir, ctx, hub };

      await addNode(deps, "n.1");
      const at = ctx.log.head;
      await addNode(deps, "n.2");
      await addNode(deps, "n.3");

      // A client that arrives late, holding the graph as of `at`.
      const late = await watcher(hub, "client-late");
      await Effect.runPromise(
        hub.handleMessage("client-late", JSON.stringify({ op: "since", rev: at })),
      );
      expect(txFrames(late).map((f) => f.rev)).toEqual([at + 1, at + 2]);
      expect(txFrames(late).flatMap((f) => f.upserts.map((n) => n.id))).toEqual(["n.2", "n.3"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("since answers snapshot-required past the window and ahead of head", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const deps = { root: dir, ctx, hub };
      await addNode(deps, "n.1");
      const frames = await watcher(hub, "client-a");

      // Ahead of head: this rev was counted by a previous server process.
      await Effect.runPromise(
        hub.handleMessage("client-a", JSON.stringify({ op: "since", rev: ctx.log.head + 4 })),
      );
      expect(frames.at(-1)).toEqual({ op: "snapshot-required", head: ctx.log.head });
      expect(txFrames(frames)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("dispose detaches the hub from the log", async () => {
    const dir = await root();
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const deps = { root: dir, ctx, hub };
      const a = await watcher(hub, "client-a");
      hub.dispose();
      await addNode(deps, "n.after", "client-a");
      expect(txFrames(a)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
