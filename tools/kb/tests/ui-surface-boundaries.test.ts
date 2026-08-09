import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as assets from "../src/surface/ui/assets.ts";
import { handleHttpRequest } from "../src/surface/ui/http.ts";
import { UI_DIST } from "../src/surface/ui/paths.ts";
import { listSavedQueries, savedQueryNodes } from "../src/surface/ui/saved-queries.ts";
import {
  contentHash,
  diffNodes,
  normalizeRows,
  rowsHash,
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

  test("serveKbAsset rejects traversal and missing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-ui-assets-"));
    await mkdir(join(root, ".kb", "assets"), { recursive: true });
    await writeFile(join(root, ".kb", "assets", "ok.png"), "png-bytes");

    const ok = await serveKbAsset(root, "/assets/ok.png");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/png");
    expect(await ok.text()).toBe("png-bytes");

    const missing = await serveKbAsset(root, "/assets/nope.png");
    expect(missing.status).toBe(404);

    const traversal = await serveKbAsset(root, "/assets/../nodes.jsonl");
    expect(traversal.status).toBe(403);
  });

  test("serveStatic returns null when UI dist is absent", async () => {
    // UI_DIST may or may not exist in this checkout; when missing, null.
    // When present, a traversal outside dist is forbidden.
    const missingBuild = !(await Bun.file(join(UI_DIST, "index.html")).exists());
    if (missingBuild) {
      expect(await serveStatic("/")).toBeNull();
    } else {
      const forbidden = await serveStatic("/../package.json");
      expect(forbidden?.status).toBe(403);
      const spa = await serveStatic("/some/client/route");
      expect(spa?.status).toBe(200);
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
});

describe("ui http boundary", () => {
  test("unknown /api path is 404; non-api falls through to static/503", async () => {
    const hub = {
      snapshot: { rev: 0, nodes: [] },
      applyNodes() {},
    };
    const ctx = { nodes: [] };

    const api404 = await handleHttpRequest(
      new Request("http://127.0.0.1/api/nope"),
      // session hub/ctx are only needed for graph/action paths
      { root: "/tmp", ctx: ctx as never, hub: hub as never },
    );
    expect(api404.status).toBe(404);

    const fallback = await handleHttpRequest(
      new Request("http://127.0.0.1/"),
      { root: "/tmp", ctx: ctx as never, hub: hub as never },
    );
    // Built UI → 200 SPA; unbuilt → 503 ui_not_built.
    if (fallback.status === 503) {
      const body = (await fallback.json()) as { error: string };
      expect(body.error).toBe("ui_not_built");
    } else {
      expect(fallback.status).toBe(200);
    }
  });

  test("rejected serveKbAsset becomes controlled 500 (not handler reject)", async () => {
    const spy = spyOn(assets, "serveKbAsset").mockImplementation(() =>
      Promise.reject(new Error("asset-read-failed")),
    );
    try {
      const res = await handleHttpRequest(
        new Request("http://127.0.0.1/assets/x.png"),
        {
          root: "/tmp",
          ctx: { nodes: [] } as never,
          hub: { snapshot: { rev: 0, nodes: [] }, applyNodes() {} } as never,
        },
      );
      expect(res.status).toBe(500);
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
