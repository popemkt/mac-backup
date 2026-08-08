/**
 * C1 — canvas MVP: JSON Canvas doc helpers + ext.canvas.tx.apply.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  EMPTY_CANVAS_DOC,
  parseCanvasDoc,
  reconcileCanvasDoc,
  removeCanvasEdge,
  stringifyCanvasDoc,
  upsertCanvasEdge,
  upsertCanvasNode,
  type CanvasDoc,
} from "../src/canvas/doc.ts";
import { openKb } from "../src/context.ts";
import { SYSTEM_IDS } from "../src/foundation/model.ts";
import { ensureSystemSeed, systemSeedNodes } from "../src/foundation/seed.ts";
import { invoke, resetRegistryCache } from "../src/registry.ts";

let roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "kb-canvas-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

describe("C1 seed: canvas tag + field", () => {
  test("seeds sys.tag.canvas templating sys.f.canvas", () => {
    const seed = systemSeedNodes();
    const byId = new Map(seed.map((n) => [n.id, n]));
    const tag = byId.get(SYSTEM_IDS.canvasTag);
    expect(tag).toBeDefined();
    expect(tag!.text).toBe("canvas");
    expect(tag!.props[SYSTEM_IDS.typeField]).toEqual([
      { t: "ref", v: SYSTEM_IDS.tag },
    ]);
    expect(tag!.props[SYSTEM_IDS.fieldsField]).toEqual([
      { t: "ref", v: SYSTEM_IDS.canvasField },
    ]);
    const field = byId.get(SYSTEM_IDS.canvasField);
    expect(field).toBeDefined();
    expect(field!.props[SYSTEM_IDS.typeField]).toEqual([
      { t: "ref", v: SYSTEM_IDS.field },
    ]);
  });

  test("ensureSystemSeed is idempotent over canvas nodes", () => {
    const first = ensureSystemSeed([]);
    expect(first.seeded).toBe(true);
    const again = ensureSystemSeed(first.nodes);
    expect(again.seeded).toBe(false);
  });
});

describe("canvas doc parse/patch round-trip", () => {
  test("empty doc round-trips", () => {
    const str = stringifyCanvasDoc(EMPTY_CANVAS_DOC);
    expect(parseCanvasDoc(str)).toEqual({ nodes: [], edges: [] });
  });

  test("kb-node + layout edge + native kbLink round-trip", () => {
    let doc: CanvasDoc = { nodes: [], edges: [] };
    doc = upsertCanvasNode(doc, {
      id: "card-a",
      type: "kb-node",
      nodeId: "n.source",
      x: 10,
      y: 20,
      width: 240,
      height: 80,
    });
    doc = upsertCanvasNode(doc, {
      id: "card-b",
      type: "kb-node",
      nodeId: "n.target",
      x: 300,
      y: 20,
      width: 240,
      height: 80,
    });
    doc = upsertCanvasEdge(doc, {
      id: "e1",
      fromNode: "card-a",
      toNode: "card-b",
      fromSide: "right",
      toSide: "left",
      toEnd: "arrow",
      kbLink: {
        mode: "native",
        via: "prop",
        fieldId: "f.related",
        sourceNodeId: "n.source",
        targetNodeId: "n.target",
        bindingId: "bind-1",
      },
    });
    const again = parseCanvasDoc(stringifyCanvasDoc(doc));
    expect(again).toEqual(doc);
  });

  test("removeCanvasEdge drops by id", () => {
    const doc = removeCanvasEdge(
      {
        nodes: [],
        edges: [
          { id: "e1", fromNode: "a", toNode: "b" },
          { id: "e2", fromNode: "b", toNode: "c" },
        ],
      },
      "e1",
    );
    expect(doc.edges.map((e) => e.id)).toEqual(["e2"]);
  });
});

describe("reconciler", () => {
  const base: CanvasDoc = {
    nodes: [
      {
        id: "c1",
        type: "kb-node",
        nodeId: "n.a",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
      },
      {
        id: "c2",
        type: "kb-node",
        nodeId: "n.b",
        x: 200,
        y: 0,
        width: 100,
        height: 40,
      },
    ],
    edges: [
      {
        id: "native-ok",
        fromNode: "c1",
        toNode: "c2",
        kbLink: {
          mode: "native",
          via: "prop",
          fieldId: "f.rel",
          sourceNodeId: "n.a",
          targetNodeId: "n.b",
          bindingId: "b1",
        },
      },
      {
        id: "native-orphan",
        fromNode: "c1",
        toNode: "c2",
        kbLink: {
          mode: "native",
          via: "prop",
          fieldId: "f.rel",
          sourceNodeId: "n.a",
          targetNodeId: "n.gone",
          bindingId: "b2",
        },
      },
      {
        id: "layout-edge",
        fromNode: "c1",
        toNode: "c2",
        kbLink: {
          mode: "layout",
          via: "prop",
          fieldId: "f.rel",
          sourceNodeId: "n.a",
          targetNodeId: "n.gone",
          bindingId: "b3",
        },
      },
    ],
  };

  test("drops orphaned native kbLink edges; keeps layout-mode", () => {
    const props: Record<string, { t: string; v: unknown }[]> = {
      "n.a|f.rel": [{ t: "ref", v: "n.b" }],
    };
    const { doc, dropped } = reconcileCanvasDoc(
      base,
      (nodeId, fieldId) => props[`${nodeId}|${fieldId}`],
    );
    expect(dropped).toEqual(["native-orphan"]);
    expect(doc.edges.map((e) => e.id).sort()).toEqual([
      "layout-edge",
      "native-ok",
    ]);
  });

  test("layout-mode edge survives prop changes (no native bind)", () => {
    const { doc, dropped } = reconcileCanvasDoc(base, () => undefined);
    expect(dropped).toEqual(["native-ok", "native-orphan"]);
    expect(doc.edges.map((e) => e.id)).toEqual(["layout-edge"]);
  });
});

describe("ext.canvas.tx.apply", () => {
  test("atomically writes canvas JSON + source prop in one commit", async () => {
    const root = await tempRoot();
    const ctx = await openKb(root);

    const field = await invoke(ctx, {
      id: "field.define",
      input: { name: "related", id: "f.related" },
    });
    expect(field.status).toBe("succeeded");

    const src = await invoke(ctx, {
      id: "node.add",
      input: { text: "Source", id: "n.source" },
    });
    const tgt = await invoke(ctx, {
      id: "node.add",
      input: { text: "Target", id: "n.target" },
    });
    expect(src.status).toBe("succeeded");
    expect(tgt.status).toBe("succeeded");

    const canvas = await invoke(ctx, {
      id: "node.add",
      input: {
        text: "Board",
        id: "n.canvas",
        tags: ["canvas"],
      },
    });
    expect(canvas.status).toBe("succeeded");

    const doc: CanvasDoc = {
      nodes: [
        {
          id: "card-a",
          type: "kb-node",
          nodeId: "n.source",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
        },
        {
          id: "card-b",
          type: "kb-node",
          nodeId: "n.target",
          x: 280,
          y: 0,
          width: 200,
          height: 80,
        },
      ],
      edges: [
        {
          id: "e1",
          fromNode: "card-a",
          toNode: "card-b",
          toEnd: "arrow",
          kbLink: {
            mode: "native",
            via: "prop",
            fieldId: "f.related",
            sourceNodeId: "n.source",
            targetNodeId: "n.target",
            bindingId: "bind-1",
          },
        },
      ],
    };

    const receipt = await invoke(ctx, {
      id: "ext.canvas.tx.apply",
      input: {
        canvasId: "n.canvas",
        doc,
        propTargetId: "n.source",
        setProps: [
          { field: "f.related", value: { t: "ref", v: "n.target" } },
        ],
      },
    });
    expect(receipt.status).toBe("succeeded");

    const canvasNode = ctx.nodes.find((n) => n.id === "n.canvas")!;
    const stored = canvasNode.props[SYSTEM_IDS.canvasField]?.[0];
    expect(stored?.t).toBe("str");
    expect(parseCanvasDoc(String(stored!.v))).toEqual(doc);

    const source = ctx.nodes.find((n) => n.id === "n.source")!;
    expect(source.props["f.related"]).toEqual([
      { t: "ref", v: "n.target" },
    ]);
  });

  test("invalid doc fails without writing props", async () => {
    const root = await tempRoot();
    const ctx = await openKb(root);
    await invoke(ctx, {
      id: "node.add",
      input: { text: "Source", id: "n.source" },
    });
    await invoke(ctx, {
      id: "node.add",
      input: { text: "Board", id: "n.canvas", tags: ["canvas"] },
    });

    const receipt = await invoke(ctx, {
      id: "ext.canvas.tx.apply",
      input: {
        canvasId: "n.canvas",
        doc: "not-json{",
        propTargetId: "n.source",
        setProps: [
          { field: SYSTEM_IDS.typeField, value: { t: "ref", v: "n.source" } },
        ],
      },
    });
    expect(receipt.status).toBe("failed");
    if (receipt.status === "failed") {
      expect(receipt.code).toBe("invalid_input");
    }
    const source = ctx.nodes.find((n) => n.id === "n.source")!;
    expect(source.props[SYSTEM_IDS.typeField]).toBeUndefined();
    const canvasNode = ctx.nodes.find((n) => n.id === "n.canvas")!;
    expect(canvasNode.props[SYSTEM_IDS.canvasField]).toBeUndefined();
  });

  test("sys-guard: refuses writes targeting sys.* nodes", async () => {
    const root = await tempRoot();
    const ctx = await openKb(root);
    const receipt = await invoke(ctx, {
      id: "ext.canvas.tx.apply",
      input: {
        canvasId: SYSTEM_IDS.canvasTag,
        doc: EMPTY_CANVAS_DOC,
      },
    });
    expect(receipt.status).toBe("failed");
    if (receipt.status === "failed") {
      expect(receipt.code).toBe("forbidden");
    }
  });

  test("delete native edge unsets prop atomically", async () => {
    const root = await tempRoot();
    const ctx = await openKb(root);
    await invoke(ctx, {
      id: "field.define",
      input: { name: "related", id: "f.related" },
    });
    await invoke(ctx, {
      id: "node.add",
      input: { text: "Source", id: "n.source" },
    });
    await invoke(ctx, {
      id: "node.add",
      input: { text: "Target", id: "n.target" },
    });
    await invoke(ctx, {
      id: "node.add",
      input: { text: "Board", id: "n.canvas", tags: ["canvas"] },
    });

    await invoke(ctx, {
      id: "ext.canvas.tx.apply",
      input: {
        canvasId: "n.canvas",
        doc: {
          nodes: [],
          edges: [
            {
              id: "e1",
              fromNode: "a",
              toNode: "b",
              kbLink: {
                mode: "native",
                via: "prop",
                fieldId: "f.related",
                sourceNodeId: "n.source",
                targetNodeId: "n.target",
                bindingId: "b1",
              },
            },
          ],
        },
        propTargetId: "n.source",
        setProps: [
          { field: "f.related", value: { t: "ref", v: "n.target" } },
        ],
      },
    });

    const del = await invoke(ctx, {
      id: "ext.canvas.tx.apply",
      input: {
        canvasId: "n.canvas",
        doc: { nodes: [], edges: [] },
        propTargetId: "n.source",
        unsetProps: [
          { field: "f.related", value: { t: "ref", v: "n.target" } },
        ],
      },
    });
    expect(del.status).toBe("succeeded");
    const source = ctx.nodes.find((n) => n.id === "n.source")!;
    expect(source.props["f.related"]).toBeUndefined();
    const canvasNode = ctx.nodes.find((n) => n.id === "n.canvas")!;
    expect(parseCanvasDoc(String(canvasNode.props[SYSTEM_IDS.canvasField]![0]!.v))).toEqual({
      nodes: [],
      edges: [],
    });
  });
});
