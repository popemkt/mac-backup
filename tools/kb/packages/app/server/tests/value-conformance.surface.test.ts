/**
 * The write check (a value must fit its field's declared type) as the HTTP
 * and WS surfaces carry it. `runtime/tests/value-conformance.test.ts` proves
 * the check at the registry every surface invokes; this proves the surfaces
 * keep it: `POST /api/action` returns the typed refusal, and a refused write
 * reaches no watcher, while the accepted one reaches every watcher once.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { openKb } from "@kb/runtime";
import type { ServerMessage } from "@kb/contracts";
import { SYSTEM_IDS, fieldTypeValue, type PropValue } from "@kb/model";
import { handleHttpRequest } from "../src/http.ts";
import { SubscriptionHub } from "../src/session.ts";

type TxFrame = Extract<ServerMessage, { op: "tx" }>;

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function served() {
  const root = await mkdtemp(join(tmpdir(), "kb-conform-surface-"));
  roots.push(root);
  await mkdir(join(root, ".kb"), { recursive: true });
  const ctx = await openKb(root);
  const hub = new SubscriptionHub(ctx);
  const deps = { root, ctx, hub };
  const action = async (id: string, input: unknown) => {
    const response = await handleHttpRequest(
      new Request("http://127.0.0.1/api/action", {
        method: "POST",
        body: JSON.stringify({ id, input }),
      }),
      deps,
    );
    return { http: response.status, receipt: (await response.json()) as Record<string, unknown> };
  };
  const frames: unknown[] = [];
  await Effect.runPromise(
    hub.addClient("watcher", (text) =>
      Effect.sync(() => {
        frames.push(JSON.parse(text));
      }),
    ),
  );
  await Effect.runPromise(
    hub.handleMessage("watcher", JSON.stringify({ op: "watch-tx", enabled: true })),
  );
  const txs = () => frames.filter((f): f is TxFrame => (f as { op: string }).op === "tx");
  return { action, txs };
}

const setEstimate = (value: PropValue) => ({
  id: "n.task",
  setProps: [{ field: "f.estimate", value }],
});

test("HTTP returns the typed refusal, and the refused write reaches no watcher", async () => {
  const { action, txs } = await served();
  await action("field.define", { name: "f.estimate", id: "f.estimate" });
  await action("node.update", {
    id: "f.estimate",
    setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("number") }],
  });
  await action("node.add", { id: "n.task", text: "Task" });
  const before = txs().length;

  const refused = await action("node.update", setEstimate({ t: "str", v: "banana" }));
  expect(refused.receipt).toMatchObject({ status: "failed", code: "invalid_input" });
  expect(String(refused.receipt["message"])).toContain("field f.estimate is number");
  // A refusal is a receipt, not a transport failure: the request itself worked.
  expect(refused.http).toBe(200);
  expect(txs().length, "a refused write is not a transaction").toBe(before);

  const accepted = await action("node.update", setEstimate({ t: "num", v: 3 }));
  expect(accepted.receipt).toMatchObject({ status: "succeeded" });
  const frame = txs().at(-1);
  expect(txs().length).toBe(before + 1);
  expect(frame?.upserts.find((n) => n.id === "n.task")?.props["f.estimate"]).toEqual([
    { t: "num", v: 3 },
  ]);
});
