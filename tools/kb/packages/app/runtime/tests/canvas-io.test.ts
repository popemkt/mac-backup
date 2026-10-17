/**
 * A canvas in and out of kb through the invoke core (DESIGN.md → Canvas
 * documents → Export): `ext.canvas.export` answers the document as JSON
 * Canvas, every field kb does not read kept, or its top view as one SVG
 * painted by the family's painter, whose look the look contract holds
 * (`canvas-ui` `canvas-look.contract.test.tsx`); `ext.canvas.diagram`
 * draws a new canvas from a query's nodes and the graph's edges among them
 * (`ext.graph.edges`), or from mermaid text. How a diagram is laid out and
 * mermaid read is `@kb/canvas`'s `diagram.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANVAS_IDS,
  MERMAID_TEXT_LIMIT,
  isShapeNode,
  parseCanvasDoc,
  type CanvasDoc,
} from "@kb/canvas";
import type { ActionInvocation, ActionReceipt } from "@kb/contracts";
import { SYSTEM_IDS, fieldTypeValue, present } from "@kb/model";
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

/** A fresh kb, at a root removed after the test. */
async function freshKb(): Promise<Kb> {
  const root = await mkdtemp(join(tmpdir(), "kb-canvas-io-"));
  roots.push(root);
  return openKb(root);
}

/** A fresh kb holding the canvas `n.canvas` with `doc` on it, and the node `n.idea`. */
async function canvasKb(doc: Record<string, unknown>): Promise<Kb> {
  const ctx = await freshKb();
  await invoke(ctx, { id: "node.add", input: { text: "Board", id: "n.canvas", tags: ["canvas"] } });
  await invoke(ctx, { id: "node.add", input: { text: "An idea & more", id: "n.idea" } });
  const applied = await invoke(ctx, {
    id: "ext.canvas.tx.apply",
    input: { canvasId: "n.canvas", doc },
  });
  expect(applied.status).toBe("succeeded");
  return ctx;
}

function stored(ctx: Kb, id = "n.canvas"): CanvasDoc {
  const node = present(
    ctx.nodes.find((n) => n.id === id),
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

/** n.a mentions n.b and is related to n.c; n.c is n.b's child; f.related is the ref field. */
async function graphKb(): Promise<Kb> {
  const ctx = await freshKb();
  await invoke(ctx, { id: "field.define", input: { name: "related", id: "f.related" } });
  await invoke(ctx, {
    id: "node.update",
    input: {
      id: "f.related",
      setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("ref") }],
    },
  });
  await invoke(ctx, { id: "node.add", input: { text: "B", id: "n.b" } });
  await invoke(ctx, { id: "node.add", input: { text: "C", id: "n.c", parent: "n.b" } });
  const a = await invoke(ctx, {
    id: "node.add",
    input: {
      text: "A mentions [[n.b]]",
      id: "n.a",
      props: [{ field: "f.related", value: { t: "ref", v: "n.c" } }],
    },
  });
  expect(a.status).toBe("succeeded");
  return ctx;
}

const byText = (x: string, y: string) => x.localeCompare(y);

describe("ext.canvas.diagram", () => {
  const QUERY =
    '[:find ?id :where [?n :node/id ?id] [(contains? #{"n.a" "n.b" "n.c" "f.related"} ?id)]]';

  test("a query's nodes are cards, the graph's edges among them edges, a typed relation bound", async () => {
    const ctx = await graphKb();
    const out = output(
      await invoke(ctx, { id: "ext.canvas.diagram", input: { query: QUERY, name: "Map" } }),
    );
    const canvasId = String(out.canvasId);
    expect(ctx.nodes.find((n) => n.id === canvasId)?.text).toBe("Map");
    const doc = stored(ctx, canvasId);
    expect(doc.nodes.map((n) => `${n.type}:${n.nodeId}`).toSorted(byText)).toEqual([
      "kb-node:n.a",
      "kb-node:n.b",
      "kb-node:n.c",
    ]);
    const edges = doc.edges
      .map((e) => `${e.fromNode}->${e.toNode}:${e.kbLink?.mode}`)
      .toSorted(byText);
    expect(edges).toEqual(["n.a->n.b:layout", "n.a->n.c:native", "n.b->n.c:layout"]);
    const typed = doc.edges.find((e) => e.kbLink?.mode === "native");
    expect([typed?.label, typed?.kbLink?.fieldId]).toEqual(["related", "f.related"]);
    // The field is scaffolding: the graph elides it, and the answer says so.
    expect(out.reported).toEqual(["f.related is scaffolding the graph elides: not drawn"]);
    expect([out.items, out.edges]).toEqual([3, 3]);
  });

  test("mermaid text draws its boxes and links, and reports what it does not draw", async () => {
    const ctx = await freshKb();
    const out = output(
      await invoke(ctx, {
        id: "ext.canvas.diagram",
        input: { mermaid: "flowchart LR\n  A[Ask] -->|ok| B{Decide}\n  style A fill:#f00" },
      }),
    );
    const doc = stored(ctx, String(out.canvasId));
    expect(ctx.nodes.find((n) => n.id === out.canvasId)?.text).toBe("Diagram");
    const decide = doc.nodes.find((n) => n.id === "B");
    expect(decide !== undefined && isShapeNode(decide) && [decide.shape, decide.label]).toEqual([
      "diamond",
      "Decide",
    ]);
    expect(doc.edges.map((e) => [e.fromNode, e.toNode, e.label])).toEqual([["A", "B", "ok"]]);
    expect(out.reported).toEqual(["line 3: kb draws no style"]);
  });

  test("refuses both sources or neither, a query naming no node, text no flowchart and text past the cap, writing nothing", async () => {
    const ctx = await graphKb();
    const before = ctx.nodes.length;
    for (const input of [
      { query: QUERY, mermaid: "flowchart TD\nA-->B" },
      {},
      { query: '[:find ?id :where [?n :node/id ?id] [(= ?id "nowhere")]]' },
      { mermaid: "sequenceDiagram\nA->>B: hi" },
      { mermaid: `flowchart TD\nA${" ".repeat(MERMAID_TEXT_LIMIT)}` },
    ]) {
      const refused = await invoke(ctx, { id: "ext.canvas.diagram", input });
      expect(refused.status).toBe("failed");
    }
    expect(ctx.nodes.length).toBe(before);
  });
});
