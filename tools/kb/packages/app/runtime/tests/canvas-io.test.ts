/**
 * A canvas in and out of kb through the invoke core (DESIGN.md → Canvas
 * documents → Export): `ext.canvas.export` answers the document as JSON
 * Canvas, every field kb does not read kept, or its top view as one SVG
 * painted by the family's painter, whose look the look contract holds
 * (`canvas-ui` `canvas-look.contract.test.tsx`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANVAS_IDS, parseCanvasDoc, type CanvasDoc } from "@kb/canvas";
import type { ActionInvocation, ActionReceipt } from "@kb/contracts";
import { present } from "@kb/model";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

type Kb = Awaited<ReturnType<typeof openKb>>;

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

/** A fresh kb holding the canvas `n.canvas` with `doc` on it, and the node `n.idea`. */
async function canvasKb(doc: Record<string, unknown>): Promise<Kb> {
  const root = await mkdtemp(join(tmpdir(), "kb-canvas-io-"));
  roots.push(root);
  const ctx = await openKb(root);
  await invoke(ctx, { id: "node.add", input: { text: "Board", id: "n.canvas", tags: ["canvas"] } });
  await invoke(ctx, { id: "node.add", input: { text: "An idea & more", id: "n.idea" } });
  const applied = await invoke(ctx, {
    id: "ext.canvas.tx.apply",
    input: { canvasId: "n.canvas", doc },
  });
  expect(applied.status).toBe("succeeded");
  return ctx;
}

function stored(ctx: Kb): CanvasDoc {
  const node = present(
    ctx.nodes.find((n) => n.id === "n.canvas"),
    "canvas",
  );
  const raw = present(node.props[CANVAS_IDS.canvasField]?.[0], "canvas doc");
  return parseCanvasDoc(String(raw.v));
}

function output(receipt: ActionReceipt): Record<string, unknown> {
  if (receipt.status !== "succeeded") throw new Error(`failed: ${receipt.message}`);
  return receipt.output as Record<string, unknown>;
}

const exported = (ctx: Kb, format: string, rest: Partial<ActionInvocation> = {}) =>
  invoke(ctx, { id: "ext.canvas.export", input: { canvasId: "n.canvas", format }, ...rest });

/** Items of every kind, an edge with a label, and fields kb does not read. */
const DOC = {
  nodes: [
    { id: "t", type: "text", text: "Hello <world>", x: 0, y: 0, width: 200, height: 80 },
    {
      id: "s",
      type: "shape",
      shape: "diamond",
      label: "Decide",
      x: 300,
      y: 0,
      width: 160,
      height: 120,
      color: "1",
      style: { dash: "dashed", font: "mono" },
      vendor: { kept: true },
    },
    { id: "k", type: "kb-node", nodeId: "n.idea", x: 0, y: 200, width: 220, height: 90 },
    { id: "f", type: "file", file: "assets/pic.png", x: 300, y: 200, width: 120, height: 90 },
    { id: "z", type: "zigzag", x: 600, y: 0, width: 50, height: 50, mystery: 7 },
  ],
  edges: [{ id: "e", fromNode: "t", toNode: "s", label: "yes & no", toEnd: "arrow" }],
  vendorDoc: "kept",
};

describe("ext.canvas.export", () => {
  test("json-canvas is the stored document, kb's fields and every field it does not read kept", async () => {
    const ctx = await canvasKb(DOC);
    const out = output(await exported(ctx, "json-canvas"));
    expect(out.mediaType).toBe("application/json");
    const text = String(out.text);
    expect(parseCanvasDoc(text)).toEqual(stored(ctx));
    const raw = JSON.parse(text) as Record<string, unknown>;
    expect(raw.vendorDoc).toBe("kept");
    expect(JSON.stringify(raw.nodes)).toContain('"vendor":{"kept":true}');
    expect(JSON.stringify(raw.nodes)).toContain('"type":"zigzag"');
  });

  test("svg is one standalone document: every item and edge, by id, with its tokens' values", async () => {
    const ctx = await canvasKb(DOC);
    const out = output(await exported(ctx, "svg"));
    expect(out.mediaType).toBe("image/svg+xml");
    const svg = String(out.text);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    for (const id of ["t", "s", "k", "f", "z"]) expect(svg).toContain(`data-card-id="${id}"`);
    expect(svg).toContain('data-edge-id="e"');
    // Words are escaped; a card's words are its node's; a picture is its asset path.
    expect(svg).toContain("Hello &lt;world&gt;");
    expect(svg).toContain("yes &amp; no");
    expect(svg).toContain("An idea &amp; more");
    expect(svg).toContain('href="assets/pic.png"');
    // Its looks are said through the tokens, which the file itself defines.
    expect(svg).toContain("var(--canvas-color-1)");
    expect(svg).toContain("var(--app-font-mono)");
    expect(svg).toMatch(/<style>svg \{[^}]*--canvas-color-1: #/);
    expect(svg).toMatch(/<style>svg \{[^}]*--app-font-mono: monospace;/);
  });

  test("is a read: it writes nothing, and a node that is no canvas is refused", async () => {
    const ctx = await canvasKb(DOC);
    const before = stored(ctx);
    output(await exported(ctx, "svg"));
    expect(stored(ctx)).toEqual(before);
    const refused = await invoke(ctx, {
      id: "ext.canvas.export",
      input: { canvasId: "n.idea", format: "svg" },
    });
    expect(refused.status).toBe("failed");
  });

  test("offers no format it cannot write", async () => {
    const ctx = await canvasKb(DOC);
    const png = await exported(ctx, "png");
    expect(png.status).toBe("failed");
  });
});
