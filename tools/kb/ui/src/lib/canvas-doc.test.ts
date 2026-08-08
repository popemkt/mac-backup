import { afterEach, describe, expect, test, vi } from "vitest";
import {
  parseCanvasDoc,
  pruneOrphanEdges,
  reconcileCanvasDoc,
  stringifyCanvasDoc,
  type CanvasDoc,
} from "@kb/canvas";
import {
  hasPropRef,
  planNativeBind,
  isValidNativeTarget,
  reconcileOnRev,
  resetReconcileTimers,
} from "@/lib/canvas-api";
import { matchRoute } from "@/lib/router";
import { SYSTEM_IDS, type OutlineNode } from "@/lib/types";
import { clearAllowedRefIdsCache } from "@/lib/field-type";

afterEach(() => {
  resetReconcileTimers();
  clearAllowedRefIdsCache();
  vi.useRealTimers();
});

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

  test("empty-fieldId native demotes to layout", () => {
    const { dropped, demoted, doc } = reconcileCanvasDoc(
      {
        nodes: [],
        edges: [
          {
            id: "e",
            fromNode: "a",
            toNode: "b",
            kbLink: {
              mode: "native",
              via: "prop",
              fieldId: "",
              sourceNodeId: "s",
              targetNodeId: "t",
              bindingId: "b",
            },
          },
        ],
      },
      () => undefined,
    );
    expect(dropped).toEqual([]);
    expect(demoted).toEqual(["e"]);
    expect(doc.edges[0]?.kbLink?.mode).toBe("layout");
  });

  test("reconciler drops orphan native edges", () => {
    const doc: CanvasDoc = {
      nodes: [],
      edges: [
        {
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
        },
      ],
    };
    const { dropped } = reconcileCanvasDoc(doc, () => undefined);
    expect(dropped).toEqual(["e"]);
  });
});

describe("canvas routes", () => {
  test("matchRoute table", () => {
    expect(matchRoute("/canvas")).toEqual({ name: "canvas-list" });
    expect(matchRoute("/canvas/abc")).toEqual({ name: "canvas", id: "abc" });
    expect(matchRoute("/graph")).toEqual({ name: "graph" });
    expect(matchRoute("/")).toEqual({ name: "outline" });
  });
});

describe("bind helpers", () => {
  test("planNativeBind is idempotent when triple exists", () => {
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
  });

  test("isValidNativeTarget respects targetTag", () => {
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

describe("reconcile-during-drag", () => {
  test("busy path keeps local positions; prune is delta-only", () => {
    vi.useFakeTimers();
    const local: CanvasDoc = {
      nodes: [
        {
          id: "c1",
          type: "kb-node",
          nodeId: "n.a",
          x: 500,
          y: 500,
          width: 100,
          height: 40,
        },
      ],
      edges: [
        {
          id: "orphan",
          fromNode: "c1",
          toNode: "c1",
          kbLink: {
            mode: "native",
            via: "prop",
            fieldId: "f",
            sourceNodeId: "n.a",
            targetNodeId: "gone",
            bindingId: "b",
          },
        },
        {
          id: "keep",
          fromNode: "c1",
          toNode: "c1",
          kbLink: {
            mode: "layout",
            via: "prop",
            fieldId: "",
            sourceNodeId: "n.a",
            targetNodeId: "n.a",
            bindingId: "b2",
          },
        },
      ],
    };
    let current = local;
    const applied: CanvasDoc[] = [];
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
            [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.canvasTag }],
            [SYSTEM_IDS.canvasField]: [
              {
                t: "str",
                v: stringifyCanvasDoc({
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
                  ],
                  edges: local.edges,
                }),
              },
            ],
          },
          createdAt: "",
          updatedAt: "",
          tags: [],
        },
      ],
      [
        "n.a",
        {
          id: "n.a",
          text: "A",
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

    reconcileOnRev("canvas", nodes, {
      getLocalDoc: () => current,
      applyLocal: (d) => {
        current = d;
        applied.push(d);
      },
      isBusy: () => true,
    });

    // Local drag position preserved; orphan demoted/dropped in memory.
    expect(current.nodes[0]?.x).toBe(500);
    expect(current.nodes[0]?.y).toBe(500);
    expect(current.edges.map((e) => e.id)).toEqual(["keep"]);

    // Idle flush applies pruneOrphanEdges delta — still keeps x=500.
    vi.advanceTimersByTime(500);
    // persist may fail (no server) but applyLocal already has pruned doc
    expect(current.nodes[0]?.x).toBe(500);
    expect(pruneOrphanEdges(local, ["orphan"]).nodes[0]?.x).toBe(500);
  });
});
