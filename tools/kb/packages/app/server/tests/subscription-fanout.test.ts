/**
 * What one transaction costs the subscription hub.
 *
 * The UI opens a subscription per query node on screen, so the same board view
 * in three tabs is three subscriptions holding one query. A query's answer
 * depends on the index and not on who asked, so the hub owes the index one run
 * per distinct query per transaction — not one per subscription.
 *
 * Red case: move the evaluation back inside the per-subscription loop.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { openKb } from "@kb/runtime";
import type { KbIndex } from "@kb/query";
import { handleHttpRequest } from "../src/http.ts";
import { SubscriptionHub } from "../src/session.ts";

const SHARED = "[:find ?id :where [?n :node/id ?id]]";
const OTHER = "[:find ?t :where [?n :node/text ?t]]";

/** Count runs of the index's datalog entry point without changing its behaviour. */
function countRuns(index: KbIndex): () => number {
  let runs = 0;
  const real = index.runDatalog.bind(index);
  index.runDatalog = (edn, ...inputs) => {
    runs += 1;
    return real(edn, ...inputs);
  };
  return () => runs;
}

describe("subscription fan-out", () => {
  test("one transaction runs each distinct query once, not once per subscriber", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kb-fanout-"));
    await mkdir(join(dir, ".kb"), { recursive: true });
    try {
      const ctx = await openKb(dir);
      const hub = new SubscriptionHub(ctx);
      const frames: string[] = [];
      const send = (text: string) =>
        Effect.sync(() => {
          frames.push(text);
        });

      // Three subscriptions over two queries, spread across two clients.
      for (const clientId of ["c1", "c2"]) {
        await Effect.runPromise(hub.addClient(clientId, send));
        await Effect.runPromise(
          hub.handleMessage(clientId, JSON.stringify({ op: "subscribe", id: "s", query: SHARED })),
        );
      }
      await Effect.runPromise(
        hub.handleMessage("c1", JSON.stringify({ op: "subscribe", id: "o", query: OTHER })),
      );

      const runs = countRuns(ctx.index);
      const res = await handleHttpRequest(
        new Request("http://127.0.0.1/api/action", {
          method: "POST",
          body: JSON.stringify({ id: "node.add", input: { text: "edited", id: "n.edit" } }),
        }),
        { root: dir, ctx, hub },
      );
      expect(res.status).toBe(200);

      expect(runs()).toBe(2);

      // The shared answer still reaches both subscribers.
      const rows = frames
        .map((f) => JSON.parse(f) as { op: string; id?: string })
        .filter((f) => f.op === "rows" && f.id === "s");
      expect(rows.length).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
