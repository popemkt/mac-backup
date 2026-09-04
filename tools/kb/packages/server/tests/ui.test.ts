import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "@kb/contracts";
import { startUi, type UiServerHandle } from "../src/index.ts";

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

    // With ui/dist built, / serves the SPA; without it, a 503 hint.
    const uiRoot = await fetch(`${handle.url}/`);
    if (uiRoot.status === 503) {
      const hintBody = (await uiRoot.json()) as { error: string };
      expect(hintBody.error).toBe("ui_not_built");
    } else {
      expect(uiRoot.status).toBe(200);
      expect(await uiRoot.text()).toContain('<div id="root">');
    }

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("ws open failed")));
    });

    const hello = await waitFor(ws, (m) => m.op === "hello");
    expect(hello).toEqual({ op: "hello", rev: 0 });

    const subQuery = '[:find ?id :where [?e :node/id ?id] [?e :node/text "ui-live-node"]]';
    ws.send(JSON.stringify({ op: "subscribe", id: "s1", query: subQuery }));
    const initialRows = await waitFor(ws, (m) => m.op === "rows" && m.id === "s1");
    expect(initialRows.op).toBe("rows");
    if (initialRows.op === "rows") {
      expect(initialRows.rows.length).toBe(0);
    }

    ws.send(JSON.stringify({ op: "watch-tx", enabled: true }));

    const txPromise = waitFor(ws, (m) => m.op === "tx");
    const rowsPromise = waitFor(
      ws,
      (m) => m.op === "rows" && m.id === "s1" && Array.isArray(m.rows) && m.rows.length > 0,
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

    const badPromise = waitFor(ws, (m) => m.op === "error" && m.code === "invalid_message");
    ws.send(JSON.stringify({ op: "subscribe" }));
    const bad = await badPromise;
    expect(bad.op).toBe("error");

    ws.send(JSON.stringify({ op: "ping" }));
    const pong = await waitFor(ws, (m) => m.op === "pong");
    expect(pong).toEqual({ op: "pong" });

    ws.close();
  });

  test("render.views + render.view serve html through /api/action", async () => {
    await mkdir(join(root, ".kb", "views"), { recursive: true });
    await writeFile(
      join(root, ".kb", "views", "todos.json"),
      JSON.stringify({
        output: "docs/kb/todos.md",
        query: "[:find ?id :where [?e :node/id ?id]]",
        template: "todos",
      }),
    );
    handle = await startUi({ root, port: 0, openBrowser: false });

    const listResp = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "render.views", input: {} }),
    });
    const listReceipt = (await listResp.json()) as {
      status: string;
      output: { views: string[] };
    };
    expect(listReceipt.status).toBe("succeeded");
    expect(listReceipt.output.views).toEqual(["todos"]);

    const renderResp = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "render.view",
        input: { name: "todos", format: "html" },
      }),
    });
    const renderReceipt = (await renderResp.json()) as {
      status: string;
      output: { name: string; format: string; content: string };
    };
    expect(renderReceipt.status).toBe("succeeded");
    expect(renderReceipt.output.format).toBe("html");
    expect(renderReceipt.output.content).toContain("<!doctype html>");

    const missing = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "render.view",
        input: { name: "nope" },
      }),
    });
    const missingReceipt = (await missing.json()) as {
      status: string;
      code: string;
    };
    expect(missingReceipt.status).toBe("failed");
    expect(missingReceipt.code).toBe("not_found");
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

  test("GET /assets/* serves uploads; traversal returns 403", async () => {
    handle = await startUi({ root, port: 0, openBrowser: false });

    const upload = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "asset.upload",
        input: {
          bytes: Buffer.from("asset-body").toString("base64"),
          filename: "pic.png",
        },
      }),
    });
    const receipt = (await upload.json()) as {
      status: string;
      output: { path: string };
    };
    expect(receipt.status).toBe("succeeded");
    const path = receipt.output.path; // assets/<ulid>.png

    const ok = await fetch(`${handle.url}/${path}`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("asset-body");

    const missing = await fetch(`${handle.url}/assets/does-not-exist.png`);
    expect(missing.status).toBe(404);

    const traversal = await fetch(`${handle.url}/assets/..%2fnodes.jsonl`);
    expect(traversal.status).toBe(403);

    const man = await fetch(`${handle.url}/api/manifest`);
    const actions = (await man.json()) as { id: string }[];
    expect(actions.some((a) => a.id === "asset.upload")).toBe(true);
  });

  test("stop() cancels listen; WS close cleans hub session", async () => {
    handle = await startUi({ root, port: 0, openBrowser: false });
    const url = handle.url;
    const port = handle.port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("ws open failed")));
    });
    const hello = await waitFor(ws, (m) => m.op === "hello");
    expect(hello).toEqual({ op: "hello", rev: 0 });

    const closed = new Promise<void>((resolve) => {
      ws.addEventListener("close", () => resolve());
    });
    ws.close();
    await closed;

    await handle.stop();
    handle = null;

    expect(fetch(`${url}/api/graph`)).rejects.toThrow();
  });

  test("malformed action body is 400 invalid_input", async () => {
    handle = await startUi({ root, port: 0, openBrowser: false });
    const resp = await fetch(`${handle.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { code: string; status: string };
    expect(body.status).toBe("failed");
    expect(body.code).toBe("invalid_input");
  });
});
