import { describe, expect, test } from "vitest";
import {
  parseCanvasDoc,
  reconcileCanvasDoc,
  stringifyCanvasDoc,
  type CanvasDoc,
} from "@kb/canvas";
import { matchCanvasId, isCanvasList } from "@/lib/router";

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
  test("matchCanvasId / isCanvasList", () => {
    expect(isCanvasList("/canvas")).toBe(true);
    expect(matchCanvasId("/canvas/abc")).toBe("abc");
    expect(matchCanvasId("/")).toBeNull();
  });
});
