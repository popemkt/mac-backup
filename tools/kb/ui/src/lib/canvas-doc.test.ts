import { describe, expect, test } from "vitest";
import {
  isNativeEdgeBound,
  parseCanvasDoc,
  stringifyCanvasDoc,
  type CanvasDoc,
  type CanvasEdge,
} from "@kb/canvas";
import {
  edgePropPresent,
  hasPropRef,
  planNativeBind,
  isValidNativeTarget,
  syncDocOnRev,
} from "@/lib/canvas-api";
import { matchRoute } from "@/lib/router";
import { SYSTEM_IDS, type OutlineNode } from "@/lib/types";
import { clearAllowedRefIdsCache } from "@/lib/field-type";

describe("canvas doc (UI alias)", () => {
  test("round-trip kb-node + kbLink", () => {
    const doc: CanvasDoc = {
      nodes: [
        {
          id: "c1",
          type: "kb-node",
          nodeId: "n1",
          x: 0,
          y: 0,
          width: 100,
          height: 40,
        },
      ],
      edges: [
        {
          id: "e1",
          fromNode: "c1",
          toNode: "c1",
          kbLink: {
            mode: "layout",
            via: "prop",
            fieldId: "f",
            sourceNodeId: "n1",
            targetNodeId: "n2",
            bindingId: "b",
          },
        },
      ],
    };
    expect(parseCanvasDoc(stringifyCanvasDoc(doc))).toEqual(doc);
  });

  test("unknown type + extra fields round-trip", () => {
    const again = parseCanvasDoc(
      stringifyCanvasDoc(
        parseCanvasDoc({
          nodes: [
            {
              id: "f1",
              type: "link",
              url: "https://example.com",
              x: 0,
              y: 0,
              width: 10,
              height: 10,
            },
          ],
          edges: [],
        }),
      ),
    );
    expect(again.nodes[0]?.type).toBe("link");
    expect(again.nodes[0]?.extra?.url).toBe("https://example.com");
  });
});

describe("unbound tint computation", () => {
  const nativeEdge: CanvasEdge = {
    id: "e",
    fromNode: "a",
    toNode: "b",
    kbLink: {
      mode: "native",
      via: "prop",
      fieldId: "f",
      sourceNodeId: "s",
      targetNodeId: "t",
      bindingId: "b",
    },
  };

  test("edgePropPresent is false when prop missing (tint path)", () => {
    const nodes = new Map<string, OutlineNode>([
      [
        "s",
        {
          id: "s",
          text: "S",
          parentId: null,
          children: [],
          collapsed: false,
          props: {},
          createdAt: "",
          updatedAt: "",
          tags: [],
        },
      ],
    ]);
    expect(edgePropPresent(nativeEdge, nodes)).toBe(false);
    expect(isNativeEdgeBound(nativeEdge, () => undefined)).toBe(false);
  });

  test("edgePropPresent is true when prop present", () => {
    const nodes = new Map<string, OutlineNode>([
      [
        "s",
        {
          id: "s",
          text: "S",
          parentId: null,
          children: [],
          collapsed: false,
          props: { f: [{ t: "ref", v: "t" }] },
          createdAt: "",
          updatedAt: "",
          tags: [],
        },
      ],
    ]);
    expect(edgePropPresent(nativeEdge, nodes)).toBe(true);
  });
});

describe("canvas routes", () => {
  test("matchRoute table", () => {
    expect(matchRoute("/canvas")).toEqual({ name: "canvas-list" });
    expect(matchRoute("/canvas/abc")).toEqual({ name: "canvas", id: "abc" });
    expect(matchRoute("/graph")).toEqual({ name: "graph", perspectiveId: null });
    expect(matchRoute("/")).toEqual({ name: "outline" });
  });
});

describe("one-shot bind", () => {
  test("planNativeBind skips when triple already present", () => {
    const nodes = new Map<string, OutlineNode>([
      [
        "s",
        {
          id: "s",
          text: "S",
          parentId: null,
          children: [],
          collapsed: false,
          props: { f: [{ t: "ref", v: "t" }] },
          createdAt: "",
          updatedAt: "",
          tags: [],
        },
      ],
    ]);
    expect(hasPropRef(nodes, "s", "f", "t")).toBe(true);
    expect(planNativeBind(nodes, "s", "f", "t")).toEqual({ skip: true });
    expect(planNativeBind(nodes, "s", "f", "other").skip).toBe(false);
    expect(planNativeBind(nodes, "s", "f", "other").setProps).toEqual([
      { field: "f", value: { t: "ref", v: "other" } },
    ]);
  });

  test("isValidNativeTarget respects targetTag", () => {
    clearAllowedRefIdsCache();
    const nodes = new Map<string, OutlineNode>([
      [
        "f.rel",
        {
          id: "f.rel",
          text: "rel",
          parentId: null,
          children: [],
          collapsed: false,
          props: {
            [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
            [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
            [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: "tag.todo" }],
          },
          createdAt: "",
          updatedAt: "",
          tags: [],
        },
      ],
      [
        "n.ok",
        {
          id: "n.ok",
          text: "ok",
          parentId: null,
          children: [],
          collapsed: false,
          props: {},
          createdAt: "",
          updatedAt: "",
          tags: [{ id: "tag.todo", name: "todo", color: "#000" }],
        },
      ],
      [
        "n.bad",
        {
          id: "n.bad",
          text: "bad",
          parentId: null,
          children: [],
          collapsed: false,
          props: {},
          createdAt: "",
          updatedAt: "",
          tags: [],
        },
      ],
    ]);
    expect(isValidNativeTarget("f.rel", "n.ok", nodes, null)).toBe(true);
    expect(isValidNativeTarget("f.rel", "n.bad", nodes, null)).toBe(false);
  });
});

describe("drag/dirty live-sync guard", () => {
  test("syncDocOnRev skips when busy; applies foreign doc when idle", () => {
    const foreign: CanvasDoc = {
      nodes: [
        {
          id: "c1",
          type: "text",
          text: "from-store",
          x: 1,
          y: 2,
          width: 10,
          height: 10,
        },
      ],
      edges: [],
    };
    const nodes = new Map<string, OutlineNode>([
      [
        "canvas",
        {
          id: "canvas",
          text: "Board",
          parentId: null,
          children: [],
          collapsed: false,
          props: {
            [SYSTEM_IDS.canvasField]: [
              { t: "str", v: stringifyCanvasDoc(foreign) },
            ],
          },
          createdAt: "",
          updatedAt: "",
          tags: [],
        },
      ],
    ]);
    const applied: CanvasDoc[] = [];
    syncDocOnRev("canvas", nodes, {
      applyLocal: (d) => applied.push(d),
      isBusy: () => true,
    });
    expect(applied).toEqual([]);

    syncDocOnRev("canvas", nodes, {
      applyLocal: (d) => applied.push(d),
      isBusy: () => false,
    });
    expect(applied).toHaveLength(1);
    expect(applied[0]?.nodes[0]).toMatchObject({ text: "from-store", x: 1 });
  });
});
