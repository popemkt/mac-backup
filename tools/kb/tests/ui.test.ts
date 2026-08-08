import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "../src/surface/protocol.ts";
import { startUi, type UiServerHandle } from "../src/surface/ui.ts";

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kb-ui-"));
  await mkdir(join(root, ".kb", "queries"), { recursive: true });
  return root;
}

function waitFor(
  ws: WebSocket,
  pred: (msg: ServerMessage) => boolean,
  timeoutMs = 3000,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout waiting for WS message"));
    }, timeoutMs);

    const onMessage = (ev: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (pred(msg)) {
        cleanup();
        resolve(msg);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
    };

    ws.addEventListener("message", onMessage);
  });
}

describe("kb ui server", () => {
  let root: string;
  let handle: UiServerHandle | null = null;

  beforeEach(async () => {
    root = await tempRoot();
  });

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
    await rm(root, { recursive: true, force: true });
  });

  test("hello, subscribe→rows, action→tx+rows, bad message→error", async () => {
    await writeFile(
      join(root, ".kb", "queries", "all-ids.edn"),
      "[:find ?id :where [?e :node/id ?id]]\n",
    );

    handle = await startUi({
      root,
      port: 0,
      openBrowser: false,
    });

    const graph = await fetch(`${handle.url}/api/graph`);
    expect(graph.status).toBe(200);
    const snap = (await graph.json()) as { rev: number; nodes: unknown[] };
    expect(snap.rev).toBe(0);
    expect(snap.nodes.length).toBeGreaterThan(0);

    const man = await fetch(`${handle.url}/api/manifest`);
    expect(man.status).toBe(200);
    const actions = (await man.json()) as { id: string }[];
    expect(actions.some((a) => a.id === "node.add")).toBe(true);

    const queries = await fetch(`${handle.url}/api/queries`);
    expect(queries.status).toBe(200);
    const saved = (await queries.json()) as { name: string; edn: string }[];
    expect(saved.some((q) => q.name === "all-ids")).toBe(true);

    const uiHint = await fetch(`${handle.url}/`);
    expect(uiHint.status).toBe(503);
    const hintBody = (await uiHint.json()) as { error: string };
    expect(hintBody.error).toBe("ui_not_built");

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("ws open failed")));
    });

    const hello = await waitFor(ws, (m) => m.op === "hello");
    expect(hello).toEqual({ op: "hello", rev: 0 });

    const subQuery =
      '[:find ?id :where [?e :node/id ?id] [?e :node/text "ui-live-node"]]';
    ws.send(
      JSON.stringify({ op: "subscribe", id: "s1", query: subQuery }),
    );
    const initialRows = await waitFor(
      ws,
      (m) => m.op === "rows" && m.id === "s1",
    );
    expect(initialRows.op).toBe("rows");
    if (initialRows.op === "rows") {
      expect(initialRows.rows.length).toBe(0);
    }

    ws.send(JSON.stringify({ op: "watch-tx", enabled: true }));

    const txPromise = waitFor(ws, (m) => m.op === "tx");
    const rowsPromise = waitFor(
      ws,
      (m) =>
        m.op === "rows" &&
        m.id === "s1" &&
        Array.isArray(m.rows) &&
        m.rows.length > 0,
    );

    const actionResp = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "node.add",
        input: { text: "ui-live-node", id: "test-ui-live" },
      }),
    });
    expect(actionResp.status).toBe(200);
    const receipt = (await actionResp.json()) as {
      status: string;
      output: { id: string };
    };
    expect(receipt.status).toBe("succeeded");
    expect(receipt.output.id).toBe("test-ui-live");

    const tx = await txPromise;
    expect(tx.op).toBe("tx");
    if (tx.op === "tx") {
      expect(tx.rev).toBeGreaterThan(0);
      expect(tx.upserts.some((n) => n.id === "test-ui-live")).toBe(true);
    }

    const updatedRows = await rowsPromise;
    expect(updatedRows.op).toBe("rows");
    if (updatedRows.op === "rows") {
      expect(updatedRows.rows.some((r) => r[0] === "test-ui-live")).toBe(true);
      expect(updatedRows.rev).toBeGreaterThan(0);
    }

    const errPromise = waitFor(ws, (m) => m.op === "error");
    ws.send("not-json{{{");
    const err = await errPromise;
    expect(err.op).toBe("error");
    if (err.op === "error") {
      expect(err.code).toBe("invalid_json");
    }

    const badPromise = waitFor(
      ws,
      (m) => m.op === "error" && m.code === "invalid_message",
    );
    ws.send(JSON.stringify({ op: "subscribe" }));
    const bad = await badPromise;
    expect(bad.op).toBe("error");

    ws.send(JSON.stringify({ op: "ping" }));
    const pong = await waitFor(ws, (m) => m.op === "pong");
    expect(pong).toEqual({ op: "pong" });

    ws.close();
  });

  test("POST /api/action never throws on unknown action", async () => {
    handle = await startUi({ root, port: 0, openBrowser: false });
    const resp = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "no.such.action", input: {} }),
    });
    expect(resp.status).toBe(200);
    const receipt = (await resp.json()) as { status: string; code: string };
    expect(receipt.status).toBe("failed");
    expect(receipt.code).toBe("unknown_action");
  });
});
