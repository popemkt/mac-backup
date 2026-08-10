import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { openKb } from "../src/context.ts";
import * as assets from "../src/surface/ui/assets.ts";
import { handleHttpRequest } from "../src/surface/ui/http.ts";
import { UI_DIST } from "../src/surface/ui/paths.ts";
import { listSavedQueries, savedQueryNodes } from "../src/surface/ui/saved-queries.ts";
import {
  contentHash,
  diffNodes,
  normalizeRows,
  rowsHash,
  SubscriptionHub,
} from "../src/surface/ui/session.ts";
import type { KbNode } from "../src/foundation/model.ts";

const { assetContentType, serveKbAsset, serveStatic } = assets;

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

describe("ui assets boundary", () => {
  test("assetContentType maps known media and falls back", () => {
    expect(assetContentType("/x/a.PNG")).toBe("image/png");
    expect(assetContentType("/x/clip.webm")).toBe("video/webm");
    expect(assetContentType("/x/note.weird")).toBe("application/octet-stream");
  });

  test("serveKbAsset rejects traversal, missing files, and symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-ui-assets-"));
    await mkdir(join(root, ".kb", "assets"), { recursive: true });
    await writeFile(join(root, ".kb", "assets", "ok.png"), "png-bytes");
    await writeFile(join(root, ".kb", "assets", "inner.png"), "inner");
    await writeFile(join(root, "outside.txt"), "secret");
    await symlink(
      join(root, "outside.txt"),
      join(root, ".kb", "assets", "escape.png"),
    );
    await symlink(
      join(root, ".kb", "assets", "inner.png"),
      join(root, ".kb", "assets", "alias.png"),
    );

    const ok = await serveKbAsset(root, "/assets/ok.png");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/png");
    expect(await ok.text()).toBe("png-bytes");

    const missing = await serveKbAsset(root, "/assets/nope.png");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Content-Type")).toBeNull();
    expect(await missing.text()).toBe("not found");

    const traversal = await serveKbAsset(root, "/assets/../nodes.jsonl");
    expect(traversal.status).toBe(403);
    expect(traversal.headers.get("Content-Type")).toBeNull();
    expect(await traversal.text()).toBe("forbidden");

    const escape = await serveKbAsset(root, "/assets/escape.png");
    expect(escape.status).toBe(403);

    // In-root symlink is allowed when the canonical target stays contained.
    const alias = await serveKbAsset(root, "/assets/alias.png");
    expect(alias.status).toBe(200);
    expect(await alias.text()).toBe("inner");
  });

  test("serveStatic returns null when UI dist is absent; blocks symlink escapes", async () => {
    // UI_DIST may or may not exist in this checkout; when missing, null.
    // When present, a traversal outside dist is forbidden.
    const missingBuild = !(await Bun.file(join(UI_DIST, "index.html")).exists());
    if (missingBuild) {
      expect(await serveStatic("/")).toBeNull();
    } else {
      const forbidden = await serveStatic("/../package.json");
      expect(forbidden?.status).toBe(403);
      expect(forbidden?.headers.get("Content-Type")).toBeNull();
      const spa = await serveStatic("/some/client/route");
      expect(spa?.status).toBe(200);

      // Canonical-path containment: symlink under dist → outside file → 403.
      const outside = join(tmpdir(), `kb-ui-static-escape-${Date.now()}.txt`);
      await writeFile(outside, "secret-static");
      const linkName = `__escape_symlink_${Date.now()}.txt`;
      const linkPath = join(UI_DIST, linkName);
      try {
        await symlink(outside, linkPath);
        const escaped = await serveStatic(`/${linkName}`);
        expect(escaped?.status).toBe(403);
        expect(escaped?.headers.get("Content-Type")).toBeNull();
      } finally {
        await unlink(linkPath).catch(() => {});
        await unlink(outside).catch(() => {});
      }
    }
  });
});

describe("ui saved-queries boundary", () => {
  test("listSavedQueries reads sorted .edn names", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-ui-sq-"));
    await mkdir(join(root, ".kb", "queries"), { recursive: true });
    await writeFile(join(root, ".kb", "queries", "zeta.edn"), "[:find ?x]");
    await writeFile(join(root, ".kb", "queries", "alpha.edn"), "[:find ?y]");
    await writeFile(join(root, ".kb", "queries", "skip.txt"), "nope");

    const listed = await listSavedQueries(root);
    expect(listed.map((q) => q.name)).toEqual(["alpha", "zeta"]);
    expect(listed[0]?.edn).toContain("?y");
  });

  test("savedQueryNodes builds virtual root + children", () => {
    const nodes = savedQueryNodes([{ name: "t", edn: " [:find ?id] " }]);
    expect(nodes.map((n) => n.id)).toEqual(["sys.queries", "sys.query.t"]);
    expect(nodes[0]?.children).toEqual(["sys.query.t"]);
  });
});

describe("ui session boundary", () => {
  test("contentHash is order-insensitive; rowsHash/normalizeRows stabilize", () => {
    const a = [node("b"), node("a")];
    const b = [node("a"), node("b")];
    expect(contentHash(a)).toBe(contentHash(b));

    expect(normalizeRows(null)).toEqual([]);
    expect(normalizeRows([1, [2, 3]])).toEqual([[1], [2, 3]]);
    expect(rowsHash([["x"]])).toBe(rowsHash([["x"]]));
    expect(rowsHash([["x"]])).not.toBe(rowsHash([["y"]]));
  });

  test("diffNodes reports upserts and deletes", () => {
    const oldMap = new Map([
      ["keep", node("keep", "same")],
      ["gone", node("gone")],
      ["chg", node("chg", "old")],
    ]);
    const newMap = new Map([
      ["keep", node("keep", "same")],
      ["chg", node("chg", "new")],
      ["add", node("add")],
    ]);
    const { upserts, deletes } = diffNodes(oldMap, newMap);
    expect(deletes).toEqual(["gone"]);
    expect(upserts.map((n) => n.id).sort()).toEqual(["add", "chg"]);
  });

  test("session cleanup removes client; malformed messages become error frames", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-ui-sess-"));
    await mkdir(join(root, ".kb"), { recursive: true });
    const ctx = await openKb(root);
    const hub = new SubscriptionHub(ctx);
    const frames: string[] = [];
    const send = (text: string) =>
      Effect.sync(() => {
        frames.push(text);
      });

    await Effect.runPromise(hub.addClient("c1", send));
    expect(hub.clientCount).toBe(1);
    expect(JSON.parse(frames[0]!)).toEqual({ op: "hello", rev: 0 });

    await Effect.runPromise(hub.handleMessage("c1", "not-json{{{"));
    expect(JSON.parse(frames[1]!)).toMatchObject({
      op: "error",
      code: "invalid_json",
    });

    await Effect.runPromise(
      hub.handleMessage("c1", JSON.stringify({ op: "subscribe" })),
    );
    expect(JSON.parse(frames[2]!)).toMatchObject({
      op: "error",
      code: "invalid_message",
    });

    await Effect.runPromise(hub.removeClient("c1"));
    expect(hub.clientCount).toBe(0);

    // Messages after remove are no-ops (no throw, no frame).
    const before = frames.length;
    await Effect.runPromise(hub.handleMessage("c1", JSON.stringify({ op: "ping" })));
    expect(frames.length).toBe(before);
  });
});

describe("ui http boundary", () => {
  test("route Content-Types match pre-Effect Response.json / bare text", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-ui-http-ct-"));
    await mkdir(join(root, ".kb", "queries"), { recursive: true });
    await writeFile(join(root, ".kb", "queries", "q.edn"), "[:find ?x]");
    const ctx = await openKb(root);
    const hub = new SubscriptionHub(ctx);
    const deps = { root, ctx, hub };
    const jsonCt = "application/json;charset=utf-8";

    const graph = await handleHttpRequest(
      new Request("http://127.0.0.1/api/graph"),
      deps,
    );
    expect(graph.status).toBe(200);
    expect(graph.headers.get("Content-Type")).toBe(jsonCt);

    const queries = await handleHttpRequest(
      new Request("http://127.0.0.1/api/queries"),
      deps,
    );
    expect(queries.status).toBe(200);
    expect(queries.headers.get("Content-Type")).toBe(jsonCt);

    const manifest = await handleHttpRequest(
      new Request("http://127.0.0.1/api/manifest"),
      deps,
    );
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("Content-Type")).toBe(jsonCt);

    const api404 = await handleHttpRequest(
      new Request("http://127.0.0.1/api/nope"),
      deps,
    );
    expect(api404.status).toBe(404);
    expect(api404.headers.get("Content-Type")).toBeNull();
    expect(await api404.text()).toBe("not found");

    const badJson = await handleHttpRequest(
      new Request("http://127.0.0.1/api/action", {
        method: "POST",
        body: "not-json",
        headers: { "content-type": "application/json" },
      }),
      deps,
    );
    expect(badJson.status).toBe(400);
    expect(badJson.headers.get("Content-Type")).toBe(jsonCt);
    const badBody = (await badJson.json()) as { code: string };
    expect(badBody.code).toBe("invalid_input");

    const fallback = await handleHttpRequest(
      new Request("http://127.0.0.1/"),
      deps,
    );
    // Built UI → 200 SPA; unbuilt → 503 ui_not_built.
    if (fallback.status === 503) {
      expect(fallback.headers.get("Content-Type")).toBe(jsonCt);
      const body = (await fallback.json()) as { error: string };
      expect(body.error).toBe("ui_not_built");
    } else {
      expect(fallback.status).toBe(200);
    }
  });

  test("rejected serveKbAssetEffect becomes controlled 500 (not handler reject)", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-ui-http-500-"));
    await mkdir(join(root, ".kb"), { recursive: true });
    const ctx = await openKb(root);
    const hub = new SubscriptionHub(ctx);

    const spy = spyOn(assets, "serveKbAssetEffect").mockImplementation(
      (() => Effect.die(new Error("asset-read-failed"))) as typeof assets.serveKbAssetEffect,
    );
    try {
      const res = await handleHttpRequest(
        new Request("http://127.0.0.1/assets/x.png"),
        { root, ctx, hub },
      );
      expect(res.status).toBe(500);
      expect(res.headers.get("Content-Type")).toBe(
        "application/json;charset=utf-8",
      );
      const body = (await res.json()) as {
        status: string;
        code: string;
        message: string;
      };
      expect(body).toEqual({
        status: "failed",
        code: "internal",
        message: "asset-read-failed",
      });
    } finally {
      spy.mockRestore();
    }
  });
});
